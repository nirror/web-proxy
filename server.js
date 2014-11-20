
var http = require('http'),
    https = require('https'),
    url = require('url'),
	path = require("path"),
	fs = require("fs"),
	zlib = require('zlib'),
	Iconv = require('iconv').Iconv;

var TransformContent = require("./transform_content").TransformContent;

var portmap 		= {
        "http:" :80,
        "https:":443
    },
    re_html_partial = /("|'|=|\(\s*)[ht]{1,3}$/ig, // ', ", or = followed by one to three h's and t's at the end of the line
    re_css_partial = /(url\(\s*)[ht]{1,3}$/ig; // above, but for url( htt

// charset aliases which charset supported by native node.js
var charset_aliases = {
    'ascii':           'ascii',
    'us':              'ascii',
    'us-ascii':        'ascii',
    'utf8':            'utf8',
    'utf-8':           'utf8',
    'ucs-2':           'ucs2',
    'ucs2':            'ucs2',
    'csunicode':       'ucs2',
    'iso-10646-ucs-2': 'ucs2'
};

// charset aliases which iconv doesn't support
// this is popular jp-charset only, I think there are more...
var charset_aliases_iconv = {
    'windows-31j':  'cp932',
    'cswindows31j': 'cp932',
    'ms932':        'cp932'
};

function identityFunc(chunk) {
    return chunk;
}

var proxyServer = module.exports = function(config, callback) {

    var processChunk = config.processChunk || identityFunc;
    var verbose = (config.verbose === undefined) ? true : config.verbose;
    var log = (verbose) ? console.log : function() {};


    http.createServer(function(request, response) {
        var url_data = url.parse(request.url);

        log("(" + process.pid + ") New Request: ", request.url);

        if(url_data.pathname == "/" && request.method == "GET") {
            return handleError(null, request, response);
        }

        // disallow almost everything via robots.txt
        if(url_data.pathname == "/robots.txt"){
            response.writeHead("200", {"Content-Type": "text/plain"});
            response.write("User-agent: *\n" +
                "Disallow: /http\n" +
                "Disallow: /http:\n" +
                "Disallow: /http:/\n\n" +
                "Disallow: /https\n" +
                "Disallow: /https:\n" +
                "Disallow: /https:/\n\n"
            );
            response.end();
        }

        return proxy(request, response);

    }).listen(config.port, config.ip, callback);


    /**
    * Makes the outgoing request and relays it to the client, modifying it along the way if necessary
    *
    * todo: get better at fixing / urls
    * todo: fix urls that start with //
    */
    function proxy(request, response) {

        var headers = copy(request.headers);
        delete headers.host;

        // overwrite the referer with the correct referer
        var refererUri;
        if(headers.referer){
            headers.referer = getRealUrl(request.headers.referer);
            if(headers.referer && headers.referer.indexOf("http") !== 0) {
                headers.referer = "http://"+headers.referer;
            }
            refererUri = url.parse(headers.referer);
        }

        var remoteUrl = getRealUrl(request.url);


        if(!remoteUrl || remoteUrl.indexOf("?") === 0) {
            remoteUrl = headers.referer;
        }

        if(!remoteUrl) {
            return handleError("Resolution failed", request, response);
        }

        if(remoteUrl.indexOf("http") !== 0) {
            if(remoteUrl.indexOf("//") !== 0) {
                remoteUrl = "//"+remoteUrl;
            }
            if(refererUri && refererUri.protocol) {
                remoteUrl = refererUri.protocol+remoteUrl;
            } else {
                remoteUrl = "http:"+remoteUrl;
            }
        }

        var uri = url.parse(remoteUrl);

        if(!uri || !uri.host) {
            console.log("Invalid url", remoteUrl);
            return handleError("Resolution failed", request, response);
        }

        // host must contain a '.'
        /*if(uri.host.indexOf(".") == -1) {
            return handleError("Resolution failed", request, response);
        }*/

        uri.port = uri.port || portmap[uri.protocol];
        uri.pathname = uri.search ? uri.pathname + uri.search : uri.pathname;

        var accept_mimes = (headers.Accept && headers.Accept.split(/;|,| /).filter(function(mime) {
            return (mime.match(/([^()<>@,;:\\"\/[\]?={} \t]+)\/([^()<>@,;:\\"\/[\]?={} \t]+)/)) ? mime : undefined;
        })) || [];

        var options = {
            host: uri.hostname,
            port: uri.port,
            path: uri.pathname,
            method: request.method,
            headers: headers,
            followAllRedirects: true,
            rejectUnauthorized: false
        };

        // what protocol to use for outgoing connections.
        var proto = (uri.protocol == 'https:') ? https : http;

        var remote_request = proto.request(options, function(remote_response){

            // make a copy of the headers to fiddle with
            var headers = copy(remote_response.headers);

            var content_type = headers['content-type'] || "unknown",
                ct = content_type.split(";")[0];

            var mimes_needs_parsed = [
                'text/html',
                'application/xml+xhtml',
                'application/xhtml+xml',
                'text/css'
            ];

            var needs_parsed = (
                mimes_needs_parsed.indexOf(ct) !== -1 ||
                mimes_needs_parsed.filter(function(mime) {
                    return accept_mimes.indexOf(mime) !== -1;
                }).length > 0);

            var needs_rewrite = needs_parsed;

            // if we might be modifying the response, nuke any content-length headers
            if(needs_parsed){
                delete headers['content-length'];
            }

            headers["x-content-type-options"] && delete headers["x-content-type-options"];
            headers["x-frame-options"] && delete headers["x-frame-options"];
            headers["x-xss-protection"] && delete headers["x-xss-protection"];
            headers['set-cookie'] && delete headers['set-cookie'];

            headers["Access-Control-Allow-Origin"] = "*";
            headers["Access-Control-Allow-Headers"] = "X-Requested-With";


            // detect charset from content-type headers
            var charset = content_type.match(/\bcharset=([\w\-]+)\b/i);
            charset = charset ? normalizeIconvCharset(charset[1].toLowerCase()) : undefined;

            var needs_decoded = (needs_parsed && headers['content-encoding'] == 'gzip');

            // we're going to de-gzip it, so nuke that header
            if(needs_decoded){
                delete headers['content-encoding'];
            }

            // fix absolute path redirects
            // (relative redirects will be 302'd to the correct path, and they're disallowed by the RFC anyways
            // todo: also fix refresh and url headers
            if(headers.location && headers.location.substr(0,4) == 'http'){
                headers.location = thisSite(request) + "/" + headers.location;
                log("fixing redirect");
            }

            //  fire off out (possibly modified) headers
            response.writeHead(remote_response.statusCode, headers);

            //log("content-type: " + ct);
            //log("needs_parsed: " + needs_parsed);
            //log("needs_decoded: " + needs_decoded);


            // sometimes a chunk will end in data that may need to be modified, but it is impossible to tell
            // in that case, buffer the end and prepend it to the next chunk
            var chunk_remainder;

            // if charset is utf8, chunk may be cut in the middle of 3byte character,
            // we need to buffer the cut data and prepend it to the next chunk
            var chunk_remainder_bin;

            // todo : account for varying encodings
            function parse(chunk){
                //log("data event", request.url, chunk.toString());

                if( chunk_remainder_bin ){
                    var buf = new Buffer(chunk_remainder_bin.length + chunk.length);
                    chunk_remainder_bin.copy(buf);
                    chunk.copy(buf, chunk_remainder_bin.length);
                    chunk_remainder_bin = undefined;
                    chunk = buf;
                }
                if( charset_aliases[charset] === 'utf8' ){
                    var cut_size = utf8_cutDataSizeOfTail(chunk);
                    //log('cut_size = ' + cut_size);
                    if( cut_size > 0 ){
                        chunk_remainder_bin = new Buffer(cut_size);
                        chunk.copy(chunk_remainder_bin, 0, chunk.length - cut_size);
                        chunk = chunk.slice(0, chunk.length - cut_size);
                    }
                }

                // stringify our chunk and grab the previous chunk (if any)
                chunk = decodeChunk(chunk);

                if(chunk_remainder){
                    chunk = chunk_remainder + chunk;
                    chunk_remainder = undefined;
                }

                // first replace any complete urls
                if(needs_rewrite) {
                    chunk = TransformContent(uri.protocol+"//"+uri.host, remoteUrl, chunk);
                }

                if(ct === "text/html") {
                    // second, check if any urls are partially present in the end of the chunk,
                    // and buffer the end of the chunk if so; otherwise pass it along
                    // for this we just don't allow a tag to be cropped
                    var openingTagPos = chunk.lastIndexOf("<");
                    var closingTagPos = chunk.lastIndexOf(">");
                    if(openingTagPos > closingTagPos) {
                        chunk_remainder = chunk.substring(openingTagPos, chunk.length);
                        chunk = chunk.substr(0, openingTagPos);
                    }

                    chunk = chunk.replace('</head>', '<meta name="ROBOTS" content="NOINDEX, NOFOLLOW">\r\n</head>');

                    chunk = processChunk(chunk);
                }

                response.write(encodeChunk(chunk));
            }

            // Iconv instance for decode and encode
            var decodeIconv, encodeIconv;

            // decode chunk binary to string using charset
            function decodeChunk(chunk){
                // if charset is undefined, detect from meta headers
                if( !charset ){
                    var re = chunk.toString().match(/<meta\b[^>]*charset=([\w\-]+)/i);
                    // if we can't detect charset, use utf-8 as default
                    // CAUTION: this will become a bug if charset meta headers are not contained in the first chunk, but probability is low
                    charset = re ? normalizeIconvCharset(re[1].toLowerCase()) : 'utf-8';
                }
                //log("charset: " + charset);

                if( charset in charset_aliases ){
                    return chunk.toString(charset_aliases[charset]);
                } else {
                    if( !decodeIconv ) decodeIconv = new Iconv(charset, 'UTF-8//TRANSLIT//IGNORE');
                    return decodeIconv.convert(chunk).toString();
                }
            }

            // normalize charset which iconv doesn't support
            function normalizeIconvCharset(charset){
                return charset in charset_aliases_iconv ? charset_aliases_iconv[charset] : charset;
            }

            // encode chunk string to binary using charset
            function encodeChunk(chunk){
                if( charset in charset_aliases ){
                    return new Buffer(chunk, charset_aliases[charset]);
                } else {
                    if( !encodeIconv ) encodeIconv = new Iconv('UTF-8', charset + '//TRANSLIT//IGNORE');
                    return encodeIconv.convert(chunk);
                }
            }

            // check tail of the utf8 binary and return the size of cut data
            // if the data is invalid, return 0
            function utf8_cutDataSizeOfTail(bin){
                var len = bin.length;
                if( len < 4 ) return 0; // don't think about the data of less than 4byte

                // count bytes from tail to last character boundary
                var skipped = 0;
                for( var i=len; i>len-4; i-- ){
                    var b = bin[i-1];
                    if( (b & 0x7f) === b ){ // 0xxxxxxx (1byte character boundary)
                        if( i === len ){
                            return 0;
                        } else {
                            break; // invalid data
                        }
                    } else if( (b & 0xbf) === b ){ //10xxxxxx (is not a character boundary)
                        skipped++;
                    } else if( (b & 0xdf) === b ){ //110xxxxx (2byte character boundary)
                        if( skipped === 0 ){
                            return 1;
                        } else if( skipped === 1 ){
                            return 0;
                        } else {
                            break; // invalid data
                        }
                    } else if( (b & 0xef) === b ){ //1110xxxx (3byte character boundary)
                        if( skipped <= 1 ){
                            return 1 + skipped;
                        } else if( skipped === 2 ){
                            return 0;
                        } else {
                            break; // invalid data
                        }
                    } else if( (b & 0xf7) === b ){ //11110xxx (4byte character boundary)
                        if( skipped <= 2 ){
                            return 1 + skipped;
                        } else if( skipped === 3 ) {
                            return 0;
                        } else {
                            break; // invalid data
                        }
                    }
                }
                // invalid data, return 0
                return 0;
            }

            // if we're dealing with gzipped input, set up a stream decompressor to handle output
            if(needs_decoded) {
                remote_response = remote_response.pipe(zlib.createUnzip());
            }

            // set up a listener for when we get data from the remote server - parse/decode as necessary
            remote_response.addListener('data', function(chunk){
                if(needs_parsed) {
                    parse(chunk);
                } else {
                    response.write(chunk);
                }
            });

            // clean up the connection and send out any orphaned chunk
            remote_response.addListener('end', function() {
                // if we buffered a bit of text but we're now at the end of the data, then apparently
                // it wasn't a url - send it along
                if(chunk_remainder){
                    response.write(chunk_remainder);
                    chunk_remainder = undefined;
                }
                response.end();
            });

        });

        remote_request.setTimeout(5000, function() {
            remote_request.end();
            response.writeHead(504);
            response.end();
        });

        remote_request.addListener('error', function(err) {
            handleError(err, request, response);
        });

        // pass along POST data
        request.addListener('data', function(chunk){
            remote_request.write(chunk);
        });

        // let the remote server know when we're done sending data
        request.addListener('end', function(){
            remote_request.end();
        });


    }

    function handleError(err, request, response) {
        if(err) response.writeHead(500, err.toString());
        var errorContent = "<html><head></head><body>"+(err || "").toString()+"</body></html>";
        errorContent = processChunk(errorContent);
        response.write(errorContent);
        response.end();
    }

    /**
    * Takes a /http://site.com url from a request or a referer and returns the http://site.com/ part
    */
    function getRealUrl(path){
        var uri = url.parse(path),
            real_url = uri.pathname.substr(1); // "/" is 1 character long.
        // we also need to include any querystring data in the real_url
        return uri.search ? real_url + uri.search : real_url;
    }

    // returns the configured host if one exists, otherwise the host that the current request came in on
    function thisHost(request){
        return (config.host) ? config.host : request.headers.host;
    }

    // returns the http://site.com
    function thisSite(request){
        return 'http://' + thisHost(request);
    }

    /**
    * returns a shallow copy of an object
    */
    function copy(source){
        var n = {};
        for(var key in source){
            if(source.hasOwnProperty(key)){
                n[key] = source[key];
            }
        }
        return n;
    }

};

if(require.main === module) {
    var config = {
        host: "localhost",
        port: 9090
    };
    proxyServer(config, function() {
        console.log('proxy server process started on port '+config.port+' with pid '+process.pid);
    });
}
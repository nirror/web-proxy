/**
 * Original source from: https://code.google.com/p/mirrorrr/source/browse/trunk/transform_content.py
 * Copyright 2008 Brett Slatkin - Apache License 2.0
 * RegExp conversion from Python to XRegExp :
 *             Capture         Backreference    In replacement   Stored at
 * - Python :  (?P<name>...)   (?P=name)        \g<name>         result.group('name')
 * - XRegExp : (<name>...)     \k<name>         ${name}          result.name
 */

var util = require("util");
var path = require("path");
var url = require("url");
var sprintf = require("sprintf-js").sprintf;
var XRegExp = require("xregexp").XRegExp;


var ABSOLUTE_URL_REGEX2 = "//(?<url>[^\"'> \t\\)]+)";

// URLs that have absolute addresses
var ABSOLUTE_URL_REGEX = "(?<protocol>http(s?):)?//(?<url>[^\"'> \t\\)]+)";

// URLs that are relative to the base of the current hostname.
var BASE_RELATIVE_URL_REGEX = "/(?!(/)|(http(s?)://)|(url\\())(?<url>[^\"'> \t\\)]*)";

// URLs that have '../' or './' to start off their paths.
var TRAVERSAL_URL_REGEX = "(?<relative>\\.(\\.)?)/(?!(/)|(http(s?)://)|(url\\())(?<url>[^\"'> \t\\)]*)";

// URLs that are in the same directory as the requested URL.
var SAME_DIR_URL_REGEX = "(?!(/)|(http(s?)://)|(url\\())(?<url>[^\"'> \t\\)]+)";

// URL matches the root directory.
var ROOT_DIR_URL_REGEX = "(?!//(?!>))/(?<url>)(?=[ \t\n]*[\"'\\)>/])";

// Start of a tag using 'src' or 'href'
var TAG_START = "\\b(?<tag>src|href|action|url|background)(?<equals>[\r\n\t ]*=[\r\n\t ]*)(?<quote>[\"'](?!data:))";

// Start of a CSS import
var CSS_IMPORT_START = "@import(?<spacing>[\t ]+)(?<quote>[\"']?)";

// CSS url() call
var CSS_URL_START = "\\burl\\((?<quote>[\"' ]?(?!data:))";


var REPLACEMENT_REGEXES = [
    [TAG_START + SAME_DIR_URL_REGEX, "${tag}${equals}${quote}%(accessed_dir)s${url}"],
    [TAG_START + TRAVERSAL_URL_REGEX, "${tag}${equals}${quote}%(accessed_dir)s/${relative}/${url}"],
    [TAG_START + BASE_RELATIVE_URL_REGEX, "${tag}${equals}${quote}/%(base)s/${url}"],
    [TAG_START + ROOT_DIR_URL_REGEX, "${tag}${equals}${quote}/%(base)s/"],

// Need this because HTML tags could end with '/>', which confuses the
// tag-matching regex above, since that's the end-of-match signal.
    [TAG_START + ABSOLUTE_URL_REGEX2, "${tag}${equals}${quote}/http://${url}"],
    [TAG_START + ABSOLUTE_URL_REGEX, "${tag}${equals}${quote}/${protocol}//${url}"],
    [CSS_IMPORT_START + SAME_DIR_URL_REGEX, "@import${spacing}${quote}%(accessed_dir)s${url}"],
    [CSS_IMPORT_START + TRAVERSAL_URL_REGEX, "@import${spacing}${quote}%(accessed_dir)s/${relative}/${url}"],
    [CSS_IMPORT_START + BASE_RELATIVE_URL_REGEX, "@import${spacing}${quote}/%(base)s/${url}"],
    [CSS_IMPORT_START + ABSOLUTE_URL_REGEX, "@import${spacing}${quote}/${protocol}//${url}"],
    [CSS_URL_START + SAME_DIR_URL_REGEX, "url(${quote}%(accessed_dir)s${url}"],
    [CSS_URL_START + TRAVERSAL_URL_REGEX, "url(${quote}%(accessed_dir)s/${relative}/${url}"],
    [CSS_URL_START + BASE_RELATIVE_URL_REGEX, "url(${quote}/%(base)s/${url}"],
    [CSS_URL_START + ABSOLUTE_URL_REGEX, "url(${quote}/${protocol}//${url}"],
].map(function(replacementTuple) {
    return [ XRegExp(replacementTuple[0], "gim"), replacementTuple[1] ];
});

function dirname(pathname) {
    if(pathname.slice(-1) === "/") {
        return pathname;
    }
    return path.dirname(pathname);
}

function TransformContent(base_url, accessed_dir, content) {
    var accessed_dir_uri = url.parse(accessed_dir);
    accessed_dir = accessed_dir_uri.protocol+"//"+accessed_dir_uri.host+dirname(accessed_dir_uri.pathname);
    if(accessed_dir.substr(-1) != "/") {
        accessed_dir += "/";
    }
    REPLACEMENT_REGEXES.forEach(function(replacementTuple) {
        var pattern = replacementTuple[0];
        var replacement = replacementTuple[1];
        var fixed_replacement = sprintf(replacement, {
            "base": base_url,
            "accessed_dir": accessed_dir
        });
        content = XRegExp.replace(content, pattern, fixed_replacement);
    });
    return content;
}

exports.TransformContent = TransformContent;

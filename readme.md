
## A web proxy for rewriting web responses on the fly. Based on [node-unblocker](https://github.com/nfriedly/node-unblocker).


# Example
Inject a javascript tag at the end of the page.

```js

var niScriptTag = [
    '<script type="text/javascript">',
    "(function(i,s,o,g,r,a,m){i['NirrorObject']=r;i[r]=i[r]||function(){",
    "(i[r].q=i[r].q||[]).push(arguments)},i[r].l=1*new Date();i[r].scriptURL=g;a=s.createElement(o),",
    "m=s.getElementsByTagName(o)[0];a.async=1;a.src=g;m.parentNode.insertBefore(a,m)",
    "})(window,document,'script','https://static.nirror.com/client/nirrorclient.js','Ni');",
    '</script>'
].join("\n");

require("web-proxy")({
	processChunk: function(html) {
		return html.replace("</body>", niScriptTag + "\n</body>");
	}
});
```

## License
This project is released under the terms of the [GNU GPL version 3](http://www.gnu.org/licenses/gpl.html)


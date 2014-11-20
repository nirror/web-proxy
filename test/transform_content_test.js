/**
 * https://code.google.com/p/mirrorrr/source/browse/trunk/transform_content_test.py
 * Copyright 2008 Brett Slatkin - Apache License 2.0
 * RegExp conversion from Python to XRegExp :
 *             Capture         Backreference    In replacement   Stored at
 * - Python :  (?P<name>...)   (?P=name)        \g<name>         result.group('name')
 * - XRegExp : (<name>...)     \k<name>         ${name}          result.name
 **/

var assert = require("assert");
var util = require("util");
var transform_content = require("../transform_content");

function _RunTransformTest(base_url, accessed_url, original, expected) {
    var tag_tests = [
        '<img src="%s"/>',
        "<img src='%s'/>",
        "<img src=%s/>",
        "<img src=\"%s'/>",
        "<img src='%s\"/>",
        "<img src  \t=  '%s'/>",
        "<img src  \t=  \t '%s'/>",
        "<img src = '%s'/>",
        '<a href="%s">',
        "<a href='%s'>",
        "<a href=%s>",
        "<a href=\"%s'>",
        "<a href='%s\">",
        "<a href \t = \t'%s'>",
        "<a href \t  = '%s'>",
        "<a href =  \t'%s'>",
        "<td background=%s>",
        "<td background='%s'>",
        '<td background="%s">',
        '<form action="%s">',
        "<form action='%s'>",
        "<form action=%s>",
        "<form action=\"%s'>",
        "<form action='%s\">",
        "<form action \t = \t'%s'>",
        "<form action \t  = '%s'>",
        "<form action =  \t'%s'>",
        "@import '%s';",
        "@import '%s'\nnext line here",
        "@import \t '%s';",
        "@import %s;",
        "@import %s",
        '@import "%s";',
        '@import "%s"\nnext line here',
        "@import url(%s)",
        "@import url('%s')",
        '@import url("%s")',
        "background: transparent url(%s) repeat-x left;",
        'background: transparent url("%s") repeat-x left;',
        "background: transparent url('%s') repeat-x left;",
        '<meta http-equiv="Refresh" content="0; URL=%s">',
    ];
    tag_tests.forEach(function(tag) {
        var test = util.format(tag, original);
        var correct = util.format(tag, expected);
        var result = transform_content.TransformContent(base_url, accessed_url, test);
        console.info("Test with\n"+
                "Accessed: %s\n"+
                "Input   : %s\n"+
                "Received: %s\n"+
                "Expected: %s",
                accessed_url, test, result, correct);
        try {
            assert.equal(result, correct);
            console.log("OK");
        } catch(e) {
            console.error("FAIL", e.message);
        }
    });
}

// testBaseTransform
_RunTransformTest(
    "slashdot.org",
    "http://slashdot.org",
    "//images.slashdot.org/iestyles.css?T_2_5_0_204",
    "/images.slashdot.org/iestyles.css?T_2_5_0_204");

// testAbsolute
_RunTransformTest(
    "slashdot.org",
    "http://slashdot.org",
    "http://slashdot.org/slashdot_files/all-minified.js",
    "/slashdot.org/slashdot_files/all-minified.js");

// testAbsolute2
_RunTransformTest(
    "slashdot.org",
    "http://slashdot.org",
    "/images/foo.html",
    "/slashdot.org/images/foo.html");

// testRelative
_RunTransformTest(
    "slashdot.org",
    "http://slashdot.org",
    "images/foo.html",
    "/slashdot.org/images/foo.html");

// test inline
_RunTransformTest(
    "slashdot.org",
    "http://slashdot.org",
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
    "data:image/gif;base64,R0lGODlhAQABAIAAAP///////yH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");

// testUpDirectory
_RunTransformTest(
    "a248.e.akamai.net",
    "http://a248.e.akamai.net/foobar/is/the/path.html",
    "../layout/mh_phone-home.png",
    "/a248.e.akamai.net/foobar/is/the/../layout/mh_phone-home.png");

// testSameDirectoryRelative
_RunTransformTest(
    "a248.e.akamai.net",
    "http://a248.e.akamai.net/foobar/is/the/path.html",
    "./layout/mh_phone-home.png",
    "/a248.e.akamai.net/foobar/is/the/./layout/mh_phone-home.png");

// testSameDirectory
_RunTransformTest(
    "a248.e.akamai.net",
    "http://a248.e.akamai.net/foobar/is/the/path.html",
    "mh_phone-home.png",
    "/a248.e.akamai.net/foobar/is/the/mh_phone-home.png");

// testSameDirectoryNoParent
_RunTransformTest(
    "a248.e.akamai.net",
    "http://a248.e.akamai.net/path.html",
    "mh_phone-home.png",
    "/a248.e.akamai.net/mh_phone-home.png");

// testSameDirectoryWithParent
_RunTransformTest(
    "a248.e.akamai.net",
    "http://a248.e.akamai.net/7/248/2041/1447/store.apple.com/rs1/css/aos-screen.css",
    "aos-layout.css",
    "/a248.e.akamai.net/7/248/2041/1447/store.apple.com/rs1/css/aos-layout.css");

// testRootDirectory
_RunTransformTest(
    "a248.e.akamai.net",
    "http://a248.e.akamai.net/foobar/is/the/path.html",
    "/",
    "/a248.e.akamai.net/");

// testSecureContent
_RunTransformTest(
    "slashdot.org",
    "https://slashdot.org",
    "https://images.slashdot.org/iestyles.css?T_2_5_0_204",
    "/images.slashdot.org/iestyles.css?T_2_5_0_204");

// testPartiallySecureContent
_RunTransformTest(
    "slashdot.org",
    "http://slashdot.org",
    "https://images.slashdot.org/iestyles.css?T_2_5_0_204",
    "/images.slashdot.org/iestyles.css?T_2_5_0_204");



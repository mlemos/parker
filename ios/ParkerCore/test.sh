#!/bin/sh
# `swift test` for ParkerCore without Xcode: the Command Line Tools ship Swift
# Testing, but not on SwiftPM's default search or runtime paths. With Xcode
# installed a plain `swift test` works and this script is unnecessary.
FW=/Library/Developer/CommandLineTools/Library/Developer/Frameworks
LIBDIR=/Library/Developer/CommandLineTools/Library/Developer/usr/lib
exec swift test -Xswiftc -F"$FW" -Xlinker -F"$FW" -Xlinker -rpath -Xlinker "$FW" -Xlinker -rpath -Xlinker "$LIBDIR" "$@"

// Where the time goes. Debug builds print one line per measured step to the
// console (visible through `devicectl … launch --console`); Release builds
// measure nothing.

import Foundation

enum Perf {
    @discardableResult
    static func timed<T>(_ label: @autoclosure () -> String, _ body: () throws -> T) rethrows -> T {
        #if DEBUG
        let start = ContinuousClock.now
        defer {
            let ms = Double((ContinuousClock.now - start).components.attoseconds) / 1e15
                + Double((ContinuousClock.now - start).components.seconds) * 1000
            // stderr, not print: stdout is block-buffered when it is a pipe (devicectl --console).
            FileHandle.standardError.write(Data(String(format: "[perf] %@ %.1f ms\n", label(), ms).utf8))
        }
        #endif
        return try body()
    }
}

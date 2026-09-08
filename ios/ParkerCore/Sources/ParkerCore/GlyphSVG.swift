// The to-do glyphs arrive as SVG markup in shared/design-tokens.json — the exact
// string the Mac renders (Lucide paths, already scaled to one ink size, stroke
// divided by that scale). SwiftUI has no SVG renderer, so this reads the small
// dialect those strings use and turns it into a CGPath plus a stroke width:
//
//   <svg viewBox="0 0 24 24" ...><g transform="translate(tx ty) scale(s)"
//   stroke-width="w"><path d="..."/><rect x y width height rx/></g></svg>
//
// Path data uses M L H V C A Z (absolute and relative). Anything else is an
// error, loudly — a new Lucide glyph that needs more gets a parser change,
// not a silent blank box.

import CoreGraphics
import Foundation

// CGPath is immutable once built, so sharing it across isolation domains is
// safe even though CoreGraphics does not say so.
public struct Glyph: @unchecked Sendable {
    /// The ink, in the 24-unit grid, with the group transform applied.
    public let path: CGPath
    /// Stroke width in the same grid (already divided by the group scale).
    public let strokeWidth: CGFloat
    public static let gridSize: CGFloat = 24
}

public enum GlyphSVGError: Error, Equatable, Sendable {
    case missingGroup
    case badTransform(String)
    case badNumber(String)
    case unsupportedCommand(Character)
    case unsupportedElement(String)
}

public enum GlyphSVG {
    /// Parse one glyph's markup. An empty string (the TODO state: an empty
    /// box, on purpose) yields nil.
    public static func parse(_ svg: String) throws -> Glyph? {
        let s = svg.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        guard let g = firstTag("g", in: s) else { throw GlyphSVGError.missingGroup }
        let transform = try parseTransform(attr("transform", of: g) ?? "")
        let strokeWidth = try number(attr("stroke-width", of: g) ?? "2")

        let path = CGMutablePath()
        for tag in tags(in: s) where tag.name != "svg" && tag.name != "g" {
            switch tag.name {
            case "path":
                try appendPathData(attr("d", of: tag.text) ?? "", to: path, transform: transform)
            case "rect":
                let x = try number(attr("x", of: tag.text) ?? "0")
                let y = try number(attr("y", of: tag.text) ?? "0")
                let w = try number(attr("width", of: tag.text) ?? "0")
                let h = try number(attr("height", of: tag.text) ?? "0")
                let rx = try number(attr("rx", of: tag.text) ?? "0")
                path.addRoundedRect(in: CGRect(x: x, y: y, width: w, height: h), cornerWidth: rx, cornerHeight: rx, transform: transform)
            default:
                throw GlyphSVGError.unsupportedElement(tag.name)
            }
        }
        return Glyph(path: path, strokeWidth: strokeWidth)
    }

    // ---- Markup (just enough) ----------------------------------------------------

    struct Tag { let name: String; let text: String }

    /// Every opening tag in document order, with its full text.
    static func tags(in s: String) -> [Tag] {
        var out: [Tag] = []
        var rest = Substring(s)
        while let open = rest.firstIndex(of: "<") {
            guard let close = rest[open...].firstIndex(of: ">") else { break }
            let text = String(rest[open...close])
            rest = rest[rest.index(after: close)...]
            if text.hasPrefix("</") { continue }
            let name = text.dropFirst().prefix { $0.isLetter || $0.isNumber || $0 == "-" }
            out.append(Tag(name: String(name), text: text))
        }
        return out
    }

    static func firstTag(_ name: String, in s: String) -> String? {
        tags(in: s).first { $0.name == name }?.text
    }

    /// `attr="value"` inside one tag's text.
    static func attr(_ name: String, of tag: String) -> String? {
        guard let r = tag.range(of: " \(name)=\"") ?? tag.range(of: "\n\(name)=\"") else { return nil }
        let after = tag[r.upperBound...]
        guard let end = after.firstIndex(of: "\"") else { return nil }
        return String(after[..<end])
    }

    /// `translate(tx ty) scale(s)` — the two the export writes, in either order,
    /// composed in the order written (SVG applies them right-to-left to the
    /// point, i.e. scale first, then translate, for "translate scale").
    static func parseTransform(_ text: String) throws -> CGAffineTransform {
        var t = CGAffineTransform.identity
        var rest = Substring(text)
        while let open = rest.firstIndex(of: "(") {
            let name = rest[..<open].trimmingCharacters(in: .whitespacesAndNewlines)
            guard let close = rest[open...].firstIndex(of: ")") else { throw GlyphSVGError.badTransform(text) }
            let args = try numbers(String(rest[rest.index(after: open)..<close]))
            switch (name, args.count) {
            case ("translate", 1): t = t.translatedBy(x: args[0], y: 0)
            case ("translate", 2): t = t.translatedBy(x: args[0], y: args[1])
            case ("scale", 1): t = t.scaledBy(x: args[0], y: args[0])
            case ("scale", 2): t = t.scaledBy(x: args[0], y: args[1])
            default: throw GlyphSVGError.badTransform(text)
            }
            rest = rest[rest.index(after: close)...]
        }
        return t
    }

    // ---- Numbers -------------------------------------------------------------------------

    static func number(_ s: String) throws -> CGFloat {
        guard let d = Double(s.trimmingCharacters(in: .whitespaces)) else { throw GlyphSVGError.badNumber(s) }
        return CGFloat(d)
    }

    /// SVG number lists: separators are whitespace and commas, a minus sign
    /// starts a new number ("3.008-1.728"), and so does a second dot
    /// (".003.458" is rare in Lucide, but "0 0 1 3.008" is everywhere).
    static func numbers(_ s: String) throws -> [CGFloat] {
        var out: [CGFloat] = []
        var cur = ""
        var seenDot = false, seenExp = false
        func flush() throws {
            if cur.isEmpty { return }
            out.append(try number(cur)); cur = ""; seenDot = false; seenExp = false
        }
        for ch in s {
            switch ch {
            case " ", ",", "\n", "\t": try flush()
            case "-", "+":
                if seenExp, let last = cur.last, last == "e" || last == "E" { cur.append(ch) }
                else { try flush(); cur.append(ch) }
            case ".":
                if seenDot { try flush() }
                seenDot = true; cur.append(ch)
            case "e", "E":
                seenExp = true; cur.append(ch)
            default: cur.append(ch)
            }
        }
        try flush()
        return out
    }

    // ---- Path data -------------------------------------------------------------------------

    static func appendPathData(_ d: String, to path: CGMutablePath, transform: CGAffineTransform) throws {
        let t = transform
        var cmd: Character = " "
        var buf = ""
        var cur = CGPoint.zero        // current point, untransformed grid units
        var start = CGPoint.zero

        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

        func run(_ c: Character, _ nums: [CGFloat]) throws {
            let rel = c.isLowercase
            let u = Character(c.uppercased())
            var i = 0
            func next() -> CGFloat { defer { i += 1 }; return nums[i] }
            func need(_ n: Int) -> Bool { i + n <= nums.count }
            switch u {
            case "M":
                guard need(2) else { throw GlyphSVGError.badNumber(String(nums.count)) }
                var p = point(next(), next()); if rel { p = point(cur.x + p.x, cur.y + p.y) }
                path.move(to: p, transform: t); cur = p; start = p
                while need(2) { // implicit lineto after moveto
                    var q = point(next(), next()); if rel { q = point(cur.x + q.x, cur.y + q.y) }
                    path.addLine(to: q, transform: t); cur = q
                }
            case "L":
                while need(2) {
                    var q = point(next(), next()); if rel { q = point(cur.x + q.x, cur.y + q.y) }
                    path.addLine(to: q, transform: t); cur = q
                }
            case "H":
                while need(1) { let x = next(); let q = point(rel ? cur.x + x : x, cur.y); path.addLine(to: q, transform: t); cur = q }
            case "V":
                while need(1) { let y = next(); let q = point(cur.x, rel ? cur.y + y : y); path.addLine(to: q, transform: t); cur = q }
            case "C":
                while need(6) {
                    var c1 = point(next(), next()), c2 = point(next(), next()), q = point(next(), next())
                    if rel { c1 = point(cur.x + c1.x, cur.y + c1.y); c2 = point(cur.x + c2.x, cur.y + c2.y); q = point(cur.x + q.x, cur.y + q.y) }
                    path.addCurve(to: q, control1: c1, control2: c2, transform: t); cur = q
                }
            case "A":
                while need(7) {
                    let rx = next(), ry = next(), rot = next(), large = next() != 0, sweep = next() != 0
                    var q = point(next(), next()); if rel { q = point(cur.x + q.x, cur.y + q.y) }
                    arc(from: cur, to: q, rx: rx, ry: ry, rotationDegrees: rot, largeArc: large, sweep: sweep, into: path, transform: t)
                    cur = q
                }
            case "Z":
                path.closeSubpath(); cur = start
            default:
                throw GlyphSVGError.unsupportedCommand(c)
            }
            if i < nums.count { throw GlyphSVGError.badNumber("\(nums.count - i) leftover for \(c)") }
        }

        for ch in d {
            if ch.isLetter && ch != "e" && ch != "E" {
                if cmd != " " { try run(cmd, try numbers(buf)) }
                cmd = ch; buf = ""
            } else {
                buf.append(ch)
            }
        }
        if cmd != " " { try run(cmd, try numbers(buf)) }
    }

    /// SVG endpoint arc → cubic Béziers (the standard conversion: endpoint to
    /// center parameterization, then ≤90° segments).
    static func arc(from p0: CGPoint, to p1: CGPoint, rx rxIn: CGFloat, ry ryIn: CGFloat, rotationDegrees: CGFloat,
                    largeArc: Bool, sweep: Bool, into path: CGMutablePath, transform: CGAffineTransform) {
        if p0 == p1 { return }
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 { path.addLine(to: p1, transform: transform); return }
        let phi = rotationDegrees * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx2 = (p0.x - p1.x) / 2, dy2 = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx2 + sinPhi * dy2
        let y1p = -sinPhi * dx2 + cosPhi * dy2
        // scale radii up if the endpoints are too far apart
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let sign: CGFloat = (largeArc == sweep) ? -1 : 1
        let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let coef = sign * sqrt(max(0, num / den))
        let cxp = coef * (rx * y1p / ry)
        let cyp = coef * -(ry * x1p / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let dot = ux * vx + uy * vy
            let len = sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy))
            var a = acos(max(-1, min(1, dot / len)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }

        let segments = Int(ceil(abs(delta) / (.pi / 2)))
        let step = delta / CGFloat(segments)
        let alpha = 4.0 / 3.0 * tan(step / 4)
        var th = theta1
        for _ in 0..<segments {
            let cos1 = cos(th), sin1 = sin(th)
            let cos2 = cos(th + step), sin2 = sin(th + step)
            // unit-circle points and derivatives, then map to the ellipse
            func map(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: cx + cosPhi * rx * x - sinPhi * ry * y, y: cy + sinPhi * rx * x + cosPhi * ry * y)
            }
            let e1 = map(cos1, sin1), e2 = map(cos2, sin2)
            let c1 = CGPoint(x: e1.x + alpha * (-(sinPhi * ry * cos1) - cosPhi * rx * sin1),
                             y: e1.y + alpha * (cosPhi * ry * cos1 - sinPhi * rx * sin1))
            let c2 = CGPoint(x: e2.x - alpha * (-(sinPhi * ry * cos2) - cosPhi * rx * sin2),
                             y: e2.y - alpha * (cosPhi * ry * cos2 - sinPhi * rx * sin2))
            path.addCurve(to: e2, control1: c1, control2: c2, transform: transform)
            th += step
        }
    }
}

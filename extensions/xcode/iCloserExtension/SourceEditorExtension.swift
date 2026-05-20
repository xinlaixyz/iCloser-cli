import Foundation
import XcodeKit

class SourceEditorExtension: NSObject, XCSourceEditorExtension {
    func extensionDidFinishLaunching() {
        print("iCloser Xcode Extension loaded")
    }
}

class AnalyzeProjectCommand: NSObject, XCSourceEditorCommand {
    func perform(with invocation: XCSourceEditorCommandInvocation, completion: @escaping (Error?) -> Void) {
        runIC("t \"分析项目\" --go", completion: completion)
    }
}

class GenerateDocsCommand: NSObject, XCSourceEditorCommand {
    func perform(with invocation: XCSourceEditorCommandInvocation, completion: @escaping (Error?) -> Void) {
        runIC("docs generate", completion: completion)
    }
}

class FixCodeCommand: NSObject, XCSourceEditorCommand {
    func perform(with invocation: XCSourceEditorCommandInvocation, completion: @escaping (Error?) -> Void) {
        runIC("gen fix", completion: completion)
    }
}

class RunTaskCommand: NSObject, XCSourceEditorCommand {
    func perform(with invocation: XCSourceEditorCommandInvocation, completion: @escaping (Error?) -> Void) {
        let task = invocation.commandIdentifier.components(separatedBy: ".").last ?? "analyze"
        runIC("t \"\(task)\" --go", completion: completion)
    }
}

class ExplainSelectionCommand: NSObject, XCSourceEditorCommand {
    func perform(with invocation: XCSourceEditorCommandInvocation, completion: @escaping (Error?) -> Void) {
        let selectedText = invocation.buffer.selections
            .compactMap { $0 as? XCSourceTextRange }
            .map { range in
                let lines = invocation.buffer.lines
                var text = ""
                for i in range.start.line...range.end.line {
                    text += (lines[i] as? String) ?? ""
                }
                return text
            }
            .joined(separator: "\n")

        let escaped = selectedText.replacingOccurrences(of: "\"", with: "\\\"")
        runIC("t \"解释这段代码: \(escaped.prefix(500))\" --go", completion: completion)
    }
}

// Shared runner
func runIC(_ args: String, completion: @escaping (Error?) -> Void) {
    let task = Process()
    task.launchPath = "/usr/bin/env"
    task.arguments = ["ic"] + args.split(separator: " ").map(String.init)
    task.currentDirectoryPath = FileManager.default.currentDirectoryPath

    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe

    task.terminationHandler = { process in
        if process.terminationStatus == 0 {
            completion(nil)
        } else {
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? "Unknown error"
            completion(NSError(domain: "iCloser", code: Int(process.terminationStatus),
                userInfo: [NSLocalizedDescriptionKey: output]))
        }
    }

    try? task.run()
}

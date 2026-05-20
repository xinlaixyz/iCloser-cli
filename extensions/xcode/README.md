# iCloser Xcode Source Editor Extension

Adds iCloser commands directly into Xcode's Editor menu.

## Install

1. Open `iCloserExtension.xcodeproj` in Xcode
2. Build (Cmd+B)
3. Enable in System Preferences → Extensions → Xcode Source Editor
4. Restart Xcode

## Commands

| Command | Key | Function |
|---------|-----|----------|
| Analyze Project | — | Runs `ic t "分析项目" --go` |
| Generate Docs | — | Runs `ic docs generate` |
| Fix Code | — | Runs `ic gen fix` |
| Run Task... | — | Prompts for task description |
| Explain Selection | — | Sends selected code to AI for explanation |

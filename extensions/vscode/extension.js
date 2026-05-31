// icloser VSCode Extension
const vscode = require('vscode');
const { exec } = require('child_process');

function activate(context) {
  const terminal = vscode.window.createTerminal('icloser');

  context.subscriptions.push(
    vscode.commands.registerCommand('icloser.openTerminal', () => {
      terminal.show();
      terminal.sendText('ic');
    }),
    vscode.commands.registerCommand('icloser.runTask', () => {
      const task = vscode.window.showInputBox({ prompt: 'Task description' });
      task.then(t => { if (t) { terminal.show(); terminal.sendText(`ic t "${t}" --go`); } });
    }),
    vscode.commands.registerCommand('icloser.analyzeProject', () => {
      terminal.show();
      terminal.sendText('ic t "分析项目完成度" --go');
    }),
    vscode.commands.registerCommand('icloser.generateDocs', () => {
      terminal.show();
      terminal.sendText('ic docs generate');
    }),
    vscode.commands.registerCommand('icloser.fixError', () => {
      terminal.show();
      terminal.sendText('ic gen fix');
    })
  );
}

function deactivate() {}
module.exports = { activate, deactivate };

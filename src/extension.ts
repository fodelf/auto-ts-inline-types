import * as vscode from 'vscode';

import { error as logError, info as logInfo } from './log';
import { createService } from './service';
import { FileChangeTypes, Decoration, TextChange, Position, Service, Configuration, Disposable } from './types';

export function activate(extensionContext: vscode.ExtensionContext): void {
    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
        logError(`No root path found. Aborting.`);
        return;
    }

    const subscriptions: Disposable[] = [];
    function dispose(): void {
        let nextSubscription: Disposable | undefined;
        while ((nextSubscription = subscriptions.pop()) !== undefined) {
            nextSubscription.dispose();
        }
    }
    extensionContext.subscriptions.push({ dispose });

    createServiceForExtension(rootPath, subscriptions);
    extensionContext.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('inlineTypes')) {
            dispose();
            createServiceForExtension(rootPath, subscriptions);
        }
    }));
}

function createServiceForExtension(
    rootPath: string,
    subscriptions: Disposable[]
): Service {
    const decorationType: vscode.TextEditorDecorationType = vscode.window.createTextEditorDecorationType({});
    subscriptions.push(decorationType);

    const configuration: Configuration = mapConfiguration(vscode.workspace.getConfiguration('inlineTypes'));
    const service = createService(
        rootPath,
        configuration,
        () => updateDecorations(configuration, decorationType, service));
    updateDecorations(configuration, decorationType, service);

    const fileWatcher = vscode.workspace.createFileSystemWatcher('{!node_modules,**}/*.{ts,js}');
    fileWatcher.onDidCreate(e => service.notifyFileChange(normalizeFileName(e.fsPath), FileChangeTypes.Created));
    fileWatcher.onDidChange(e => service.notifyFileChange(normalizeFileName(e.fsPath), FileChangeTypes.Changed));
    fileWatcher.onDidDelete(e => service.notifyFileChange(normalizeFileName(e.fsPath), FileChangeTypes.Deleted));
    subscriptions.push(fileWatcher);

    vscode.window.onDidChangeActiveTextEditor(() => updateDecorations(configuration, decorationType, service));
    vscode.workspace.onDidChangeTextDocument(e => service.notifyDocumentChange(
        normalizeFileName(e.document.fileName),
        e.contentChanges.map(mapContentChange)));

    return service;
}

function mapConfiguration(configuration: vscode.WorkspaceConfiguration): Configuration {
    return {
        features: configuration.features,
        updateDelay: configuration.updateDelay,
        decorationStyle: configuration.decorationStyle,
        highlightStyle: configuration.highlightStyle,
        highlightColor: configuration.highlightColor,
    };
}

function updateDecorations(
    configuration: Configuration,
    decorationType: vscode.TextEditorDecorationType,
    service: Service
): void {
    const visibleTextEditors = vscode.window.visibleTextEditors.filter(isSupportedLanguage);
    for (const visibleTextEditor of visibleTextEditors) {
        logInfo(`Updating decorations: ${visibleTextEditor.document.fileName}`);

        const fileName = visibleTextEditor.document.fileName;
        const decorations = service.getDecorations(normalizeFileName(fileName));
        const decorationOptions = decorations.map(d => createDecorationOptions(configuration, d));
        visibleTextEditor.setDecorations(decorationType, decorationOptions);
    }
}

function createDecorationOptions(configuration: Configuration, decoration: Decoration): vscode.DecorationOptions {
    const textDecoration = `none; ${decoration.isWarning ? configuration.highlightStyle : configuration.decorationStyle}`;
    const startPosition = mapServicePosition(decoration.startPosition);
    const endPosition = mapServicePosition(decoration.endPosition);
    const lightThemeColor = decoration.isWarning ? configuration.highlightColor : "black";
    const darkThemeColor = decoration.isWarning ? configuration.highlightColor : "white";
    return {
        range: new vscode.Range(startPosition, endPosition),
        renderOptions: {
            light: {
                before: { contentText: decoration.textBefore, textDecoration, color: lightThemeColor },
                after: { contentText: decoration.textAfter, textDecoration, color: lightThemeColor }
            },
            dark: {
                before: { contentText: decoration.textBefore, textDecoration, color: darkThemeColor },
                after: { contentText: decoration.textAfter, textDecoration, color: darkThemeColor }
            }
        }
    };
}

function mapContentChange(contentChange: vscode.TextDocumentContentChangeEvent): TextChange {
    return {
        start: contentChange.range.start,
        end: contentChange.range.end,
        newText: contentChange.text
    };
}

function mapServicePosition(position: Position): vscode.Position {
    return new vscode.Position(position.line, position.character);
}

function normalizeFileName(fileName: string): string {
    return fileName.replace(/\\/g, '/');
}

function isSupportedLanguage(value: vscode.TextEditor): boolean {
    return value.document.languageId === 'typescript' || value.document.languageId === 'javascript';
}

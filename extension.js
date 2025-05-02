const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

let activeMarker = null;

function activate(context) {
  console.log('Your extension "code-documentation" is now active!');

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "code-documentation.extractCode",
      extractCodeHandler
    ),
    vscode.commands.registerCommand(
      "code-documentation.syncDocumentation",
      syncDocumentationHandler
    )
  );
}

async function extractCodeHandler() {
  const editor = vscode.window.activeTextEditor;

  if (!editor || !vscode.workspace.workspaceFolders) {
    vscode.window.showErrorMessage("No active editor or workspace found.");
    return;
  }

  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const documentPath = editor.document.uri.fsPath;

  if (!documentPath.startsWith(workspacePath)) {
    vscode.window.showErrorMessage(
      "Current document is not inside the workspace."
    );
    return;
  }

  const marker = await promptForMarker();
  if (!marker) {
    return;
  }

  activeMarker = marker;

  const { extension, extractedFragment } = await extractCodeFragment(marker);
  if (!extractedFragment) {
    vscode.window.showErrorMessage(
      `No extractable code block found for marker "${marker}".`
    );
    return;
  }

  insertCodeAtCursor(extension, editor, extractedFragment);
}

async function syncDocumentationHandler() {
  const marker = await promptForMarker();
  if (!marker) {
    return;
  }

  vscode.window.showInformationMessage(
    `Looking for code block with marker ${marker}...`
  );

  const { extension, extractedFragment: codeFragment } =
    await extractCodeFragment(marker);
  if (!codeFragment) {
    vscode.window.showErrorMessage(
      `No code block found with marker "${marker}".`
    );
    return;
  }

  const markdownFiles = await vscode.workspace.findFiles(
    "**/*.md",
    "**/node_modules/**"
  );

  for (const mdFile of markdownFiles) {
    await replaceCodeInMarkdownFile(mdFile, codeFragment, marker, extension);
  }

  vscode.window.showInformationMessage(
    `Code block with marker ${marker} synced successfully.`
  );
}

async function promptForMarker() {
  const marker = await vscode.window.showInputBox({
    prompt: "Enter the comment marker (e.g., 457659)",
    placeHolder: "e.g., 457659",
  });

  if (!marker) {
    vscode.window.showWarningMessage(
      "Operation cancelled. No marker provided."
    );
    return null;
  }

  if (!/^\d+$/.test(marker)) {
    vscode.window.showErrorMessage("Invalid marker. Only numbers are allowed.");
    return null;
  }

  return marker;
}

async function extractCodeFragment(marker) {
  const startTag = `/* extract-start ${marker} */`;
  const endTag = `/* extract-end ${marker} */`;

  const files = await vscode.workspace.findFiles(
    "**/*.{js,ts,py,java,cpp,cs}",
    "**/node_modules/**"
  );

  let fragments = [];

  for (const file of files) {
    const content = fs.readFileSync(file.fsPath, "utf8");
    const lines = content.split("\n");

    let collecting = false;
    let collectedLines = [];
    let extension = path.extname(file.fsPath).slice(1);

    for (let line of lines) {
      if (line.includes(startTag)) {
        if (collecting) {
          vscode.window.showErrorMessage(
            `Duplicate start marker "${marker}" without matching end in file ${file.fsPath}`
          );
          return { extension: null, extractedFragment: null };
        }
        collecting = true;
        continue; // Don't include start tag itself
      }

      if (line.includes(endTag)) {
        if (!collecting) {
          vscode.window.showErrorMessage(
            `End marker "${marker}" found without start marker in file ${file.fsPath}`
          );
          return { extension: null, extractedFragment: null };
        }
        collecting = false;
        fragments.push({ extension, extractedFragment: collectedLines.join("\n").trim() });
        collectedLines = [];
        continue; // Don't include end tag itself
      }

      if (collecting) {
        collectedLines.push(line);
      }
    }

    if (collecting) {
      vscode.window.showErrorMessage(
        `Missing end marker "${marker}" for a started code block in file ${file.fsPath}`
      );
      return { extension: null, extractedFragment: null };
    }
  }

  if (fragments.length === 0) {
    vscode.window.showErrorMessage(
      `No extractable code block found for marker "${marker}" in the project.`
    );
    return { extension: null, extractedFragment: null };
  } else if (fragments.length > 1) {
    vscode.window.showErrorMessage(
      `Multiple code blocks found with marker "${marker}". Please ensure each marker is unique.`
    );
    return { extension: null, extractedFragment: null };
  } else {
    return fragments[0]; // Only one fragment found
  }
}



function insertCodeAtCursor(extension, editor, code) {
  const position = editor.selection.active;
  const newPosition = new vscode.Position(position.line + 1, 0);
  const formattedCode = formatCodeBlock(code, extension, activeMarker);

  editor
    .edit((editBuilder) => editBuilder.insert(newPosition, formattedCode))
    .then((success) => {
      vscode.window.showInformationMessage(
        success
          ? "Code fragment inserted successfully."
          : "Failed to insert code fragment."
      );
    });
}

async function replaceCodeInMarkdownFile(mdFile, code, marker, extension) {
  const document = await vscode.workspace.openTextDocument(mdFile);
  const fullText = document.getText();

  const codeBlockRegex = new RegExp(
    `\`\`\`${extension}\\n([\\s\\S]*?)\`\`\``,
    "gm"
  );

  let match;
  let found = false;

  while ((match = codeBlockRegex.exec(fullText)) !== null) {
    const matchedCodeBlock = match[0];
    const markerRegex = new RegExp(
      `\\/\\*\\s*extract-start\\s+${marker}\\s*\\*\\/`
    );

    if (markerRegex.test(matchedCodeBlock)) {
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      const formattedCode = `\`\`\`${extension}
// Extracted from source code
/* extract-start ${marker} */
${code}
/* extract-end ${marker} */
\`\`\``;

      const workspaceEdit = new vscode.WorkspaceEdit();
      workspaceEdit.replace(mdFile, range, formattedCode);
      const success = await vscode.workspace.applyEdit(workspaceEdit);

      if (success) {
        console.log(
          `Code block with marker ${marker} updated in ${mdFile.fsPath}`
        );
        found = true;
      } else {
        vscode.window.showErrorMessage(
          `Failed to update code block in ${mdFile.fsPath}`
        );
      }

      break;
    }
  }

  if (!found) {
    console.log(
      `No code block with marker ${marker} found in ${mdFile.fsPath}`
    );
  }
}

function formatCodeBlock(code, extension, marker) {
  return `\n\`\`\`${extension}
// Extracted from source code
/* extract-start ${marker} */
${code}
/* extract-end ${marker} */
\`\`\`\n`;
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};

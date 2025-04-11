const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

let activeMarker = null

/**
 * Activates the extension
 * @param {vscode.ExtensionContext} context
 */

function activate(context) {
  console.log('Your extension "code-documentation" is now active!');

  let insertCodeCommand = vscode.commands.registerCommand(
    "code-documentation.extractCode",
    async function () {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showErrorMessage("No active editor found!");
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage(
          "No workspace found. Please open a folder in VS Code."
        );
        return;
      }
      const workspacePath = workspaceFolders[0].uri.fsPath;

      // Ensure the current document is inside the workspace
      if (!editor.document.uri.fsPath.startsWith(workspacePath)) {
        vscode.window.showErrorMessage(
          "Current document is not inside the workspace."
        );
        return;
      }

      // Prompt user to enter the comment marker
      const userMarker = await vscode.window.showInputBox({
        prompt: "Enter the comment marker (e.g., 457659)",
        placeHolder: "e.g., 457659",
      });

      if (!userMarker) {
        vscode.window.showWarningMessage(
          "Operation cancelled. No comment marker provided."
        );
        return;
      }

      if (!/^\d+$/.test(userMarker)) {
        vscode.window.showWarningMessage(
          "Invalid marker: Only numbers are allowed"
        );
        return;
      }

      activeMarker = userMarker;

      // Regex patterns for comment markers
      const startRegexStr = `\\/\\*\\s*extract-start\\s+${userMarker}\\s*\\*\\/`;
      const endRegexStr = `\\/\\*\\s*extract-end\\s+${userMarker}\\s*\\*\\/`;

      const startRegex = new RegExp(startRegexStr, "g");
      const endRegex = new RegExp(endRegexStr, "g");

      // Search for the code block with the specified marker
      let { extension, extractedFragment } = await searchForTagline(
        startRegex,
        endRegex
      );

      if (!extractedFragment) {
        vscode.window.showErrorMessage(
          `No extractable code block found for marker "${userMarker}" in the repository.`
        );
        return;
      }

      insertCodeAtCursor(extension, editor, extractedFragment);
    }
  );

  context.subscriptions.push(insertCodeCommand, syncDocumentationCommand);
}

async function searchForTagline(startRegex, endRegex) {
  const files = await vscode.workspace.findFiles(
    "**/*.{js,ts,py,java,cpp,cs}",
    "**/node_modules/**"
  );

  for (const file of files) {
    const filePath = file.fsPath;
    const fileContent = fs.readFileSync(filePath, "utf8");

    console.log(`Checking file: ${filePath}`);

    let matchStart;
    while ((matchStart = startRegex.exec(fileContent)) !== null) {
      const startIndex = matchStart.index + matchStart[0].length;
      let matchEnd = endRegex.exec(fileContent);
      if (matchEnd) {
        const extension = path.extname(filePath).slice(1);

        const endIndex = matchEnd.index;
        const extractedCode = fileContent
          .substring(startIndex, endIndex)
          .trim();
        return { extension, extractedFragment: extractedCode };
      }
    }
  }
  return null;
}

let syncDocumentationCommand = vscode.commands.registerCommand(
  "code-documentation.syncDocumentation",
  async () => {
    vscode.window.showInformationMessage(
      "Syncing documentation with source code..."
    );

    const sourceFiles = await vscode.workspace.findFiles(
      "**/*.{js,ts,py,java,cpp,cs}",
      "**/node_modules/**"
    );
    const markdownFiles = await vscode.workspace.findFiles(
      "**/*.md",
      "**/node_modules/**"
    );

    console.log(
      "Source files found:",
      sourceFiles.map((f) => f.fsPath)
    );
    console.log(
      "Markdown files found:",
      markdownFiles.map((f) => f.fsPath)
    );

    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.fsPath;
      const fileContent = fs.readFileSync(filePath, "utf8");

      // Regex to find all extractable code blocks
      const startRegex = /\/\*\s*extract-start\s+(\d+)\s*\*\//g;
      const endRegex = /\/\*\s*extract-end\s+(\d+)\s*\*\//g;

      let matchStart;
      while ((matchStart = startRegex.exec(fileContent)) !== null) {
        const marker = matchStart[1]; // Extract the marker ID
        const startIndex = matchStart.index + matchStart[0].length;
        const matchEnd = endRegex.exec(fileContent);

        if (matchEnd) {
          const endIndex = matchEnd.index;
          const extension = path.extname(filePath).slice(1);
          const codeFragment = fileContent
            .substring(startIndex, endIndex)
            .trim();

          console.log(`Found code block with marker ${marker} in ${filePath}`);
          console.log("Extracted code fragment:", codeFragment);

          for (const mdFile of markdownFiles) {
            await replaceCodeInMarkdownFile(
              mdFile,
              codeFragment,
              marker,
              extension
            );
          }
        }
      }
    }

    vscode.window.showInformationMessage("Documentation sync completed.");
  }
);

/**
 * Replaces the existing code block in a Markdown file if an update is needed.
 * Compares the existing code with the new code and only updates if they differ.
 * @param {vscode.Uri} mdFile - The URI of the Markdown file.
 * @param {string} code - The updated code fragment.
 * @param {string} marker - The unique comment marker.
 * @param {string} extension - The extension of the source code file
 */
async function replaceCodeInMarkdownFile(mdFile, code, marker, extension) {
  console.log(`Checking Markdown file: ${mdFile.fsPath}`);
  const document = await vscode.workspace.openTextDocument(mdFile);
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });
  const fullText = document.getText();

  const codeBlockRegex = new RegExp(
    `(\\\`\\\`\\\`${extension}\\n// Extracted from source code\\n)([\\s\\S]*?)(\\\`\\\`\\\`)`,
    "gm"
  );

  let match;
  let found = false;

  // Iterate through all matches in the document
  while ((match = codeBlockRegex.exec(fullText)) !== null) {
    const matchedCodeBlock = match[0];
    console.log(`Found code block candidate in: ${mdFile.fsPath}`);

    // Check if this code block contains the correct marker
    const markerRegex = new RegExp(
      `\\/\\*\\s*extract-start\\s+${marker}\\s*\\*\\/`
    );
    if (markerRegex.test(matchedCodeBlock)) {
      console.log(`Correct code block with marker ${marker} found.`);

      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);
      const range = new vscode.Range(startPos, endPos);

      await editor
        .edit((editBuilder) => {
          const formattedCode = `\`\`\`${extension}
// Extracted from source code
/* extract-start ${marker} */
${code}
/* extract-end ${marker} */
\`\`\``;

          editBuilder.replace(range, formattedCode);
        })
        .then((success) => {
          if (success) {
            vscode.window.showInformationMessage(
              `Code block with marker ${marker} updated successfully in ${mdFile.fsPath}`
            );
            console.log("Code block replacement successful.");
            found = true;
          } else {
            vscode.window.showErrorMessage(
              `Failed to update code block in ${mdFile.fsPath}`
            );
            console.log("Code block replacement failed.");
          }
        });

      break; // Stop after finding and updating the correct block
    }
  }

  if (!found) {
    console.log(
      `No code block with marker ${marker} found in ${mdFile.fsPath}`
    );
  }
}

function insertCodeAtCursor(extension, editor, code) {
  const position = editor.selection.active;
  const newPosition = new vscode.Position(position.line + 1, 0);

  editor
    .edit((editBuilder) => {
      const formattedCode = `\n\`\`\`${extension}\n// Extracted from source code\n/* extract-start ${activeMarker} */\n${code}\n/* extract-end ${activeMarker} */\n\`\`\`\n`;
      editBuilder.insert(newPosition, formattedCode);
    })
    .then((success) => {
      if (success) {
        vscode.window.showInformationMessage(
          "Code fragment inserted successfully."
        );
      } else {
        vscode.window.showErrorMessage("Failed to insert code fragment.");
      }
    });
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};



// const vscode = require("vscode");
// const fs = require("fs");

// function activate(context) {
//   console.log('Your extension "code-documentation" is now active!');

//   let insertCodeCommand = vscode.commands.registerCommand("code-documentation.extractCode", async function () {
//     const editor = vscode.window.activeTextEditor;
//     if (!editor) return vscode.window.showErrorMessage("No active editor found!");

//     const workspaceFolders = vscode.workspace.workspaceFolders;
//     if (!workspaceFolders) return vscode.window.showErrorMessage("No workspace folder found. Please open a folder.");

//     const userMarker = await vscode.window.showInputBox({
//       prompt: "Enter the comment marker (e.g., 457659)",
//       placeHolder: "e.g., 457659",
//     });

//     if (!userMarker) return vscode.window.showWarningMessage("Operation cancelled. No marker provided.");
//     if (!/^\d+$/.test(userMarker)) return vscode.window.showWarningMessage("Invalid marker: Only numbers allowed.");

//     let activeMarker = userMarker;
//     const startRegex = new RegExp(`/\\*\\s*extract-start\\s+${userMarker}\\s*\\*/`, "g");
//     const endRegex = new RegExp(`/\\*\\s*extract-end\\s+${userMarker}\\s*\\*/`, "g");

//     const sourceFiles = await vscode.workspace.findFiles("**/*.{js,ts,py,java,cpp,cs}", "**/node_modules/**");
//     let extractedFragment = null;

//     for (const file of sourceFiles) {
//       const fileContent = fs.readFileSync(file.fsPath, "utf8");
//       const matchStart = startRegex.exec(fileContent);
//       if (!matchStart) continue;

//       endRegex.lastIndex = matchStart.index;
//       const matchEnd = endRegex.exec(fileContent);
//       if (!matchEnd) continue;

//       extractedFragment = fileContent.substring(matchStart.index + matchStart[0].length, matchEnd.index).trim();
//       break;
//     }

//     if (!extractedFragment) return vscode.window.showErrorMessage(`No extractable code block found for marker "${userMarker}".`);

//     const position = editor.selection.active;
//     editor.edit((editBuilder) => {
//       editBuilder.insert(new vscode.Position(position.line + 1, 0), `\n\`\`\`js\n// Extracted from source code\n/* extract-start ${userMarker} */\n${extractedFragment}\n/* extract-end ${userMarker} */\n\`\`\`\n`);
//     }).then((success) => {
//       if (success) vscode.window.showInformationMessage("Code fragment inserted successfully.");
//     });
//   });

//   let syncDocumentationCommand = vscode.commands.registerCommand("code-documentation.syncDocumentation", async () => {
//     vscode.window.showInformationMessage("Syncing documentation with source code...");

//     const workspaceFolders = vscode.workspace.workspaceFolders;
//     if (!workspaceFolders) return vscode.window.showErrorMessage("No workspace folder found. Please open a folder.");

//     const sourceFiles = await vscode.workspace.findFiles("**/*.{js,ts,py,java,cpp,cs}", "**/node_modules/**");
//     const markdownFiles = await vscode.workspace.findFiles("**/*.md", "**/node_modules/**");

//     for (const sourceFile of sourceFiles) {
//       const fileContent = fs.readFileSync(sourceFile.fsPath, "utf8");
//       const startRegex = /\/\*\s*extract-start\s+(\d+)\s*\*\//g;
//       const endRegex = /\/\*\s*extract-end\s+(\d+)\s*\*\//g;

//       let matchStart;
//       while ((matchStart = startRegex.exec(fileContent)) !== null) {
//         const marker = matchStart[1];
//         endRegex.lastIndex = matchStart.index;
//         const matchEnd = endRegex.exec(fileContent);
//         if (!matchEnd) continue;

//         const extractedCode = fileContent.substring(matchStart.index + matchStart[0].length, matchEnd.index).trim();

//         for (const mdFile of markdownFiles) {
//           const document = await vscode.workspace.openTextDocument(mdFile);
//           const editor = await vscode.window.showTextDocument(document, { preview: false });

//           const fullText = document.getText();
//           const codeBlockRegex = new RegExp(
//             `(\\\`\\\`\\\`js\\n// Extracted from source code\\n)([\\s\\S]*?)(\\\`\\\`\\\`)`,
//             "gm"
//           );

//           const match = codeBlockRegex.exec(fullText);
//           if (!match) continue;

//           const markerRegex = new RegExp(`/\\*\\s*extract-start\\s+${marker}\\s*\\*/`);
//           if (!markerRegex.test(match[0])) continue;

//           const range = new vscode.Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length));

//           await editor.edit((editBuilder) => {
//             editBuilder.replace(range, `\n\`\`\`js\n// Extracted from source code\n/* extract-start ${marker} */\n${extractedCode}\n/* extract-end ${marker} */\n\`\`\`\n`);
//           });

//           vscode.window.showInformationMessage(`Code block with marker ${marker} updated in ${mdFile.fsPath}`);
//         }
//       }
//     }

//     vscode.window.showInformationMessage("Documentation sync completed.");
//   });

//   context.subscriptions.push(insertCodeCommand, syncDocumentationCommand);
// }

// function deactivate() {}

// module.exports = {
//   activate,
//   deactivate,
// };

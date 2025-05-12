# code-documentation README

A lightweight VS Code extension that helps developers maintain consistent documentation by extracting code snippets using custom comment markers and inserting or updating them in Markdown files.

## Features

1. Extract code from the source code files using comment markers
2. Insert code in a markdown document file
3. Update code in the markdown file to sync with the source code

## Getting Started

1. Clone the Repository: 
`https://github.com/toyshe/easing-code-documentation-extension.git`

2. Install the dependencies:
`npm install`

## Usage

1. Run the extension using F5

2. Open your project in the new window that opens up after running the extension

3. Wrap the fragment of code you want to extract with a comment marker like this:
`/* extract-start <6-digit comment id>*/` and `/* extract-end <6-digit comment id>*/` 

4. Open the commend palette and run the command Extract Code 

5. To update any code in the markdown, run the command Update Code in the command palette.

## Future Developments

1. Publish the extension in the VS Code Extension Marketplace
2. Add a feature that would wrap a fragment of code with a comment marker automatically
3. Add a feature that allows an option to update all the code in the markdown file


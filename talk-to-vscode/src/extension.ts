import * as vscode from 'vscode';
import { SpeechClient } from '@google-cloud/speech';
import * as recorder from 'node-record-lpcm16';
import * as stringSimilarity from 'string-similarity';

let speechClient: SpeechClient;
let isListening = false;

export function activate(context: vscode.ExtensionContext) {
	speechClient = new SpeechClient();

	const disposable = vscode.commands.registerCommand('talk-to-vscode.listen', talkToVscodeListen);

	context.subscriptions.push(disposable);
}

const talkToVscodeListen = async () => {

	if (isListening) {
		vscode.window.showInformationMessage('Already listening...');
		return;
	}

	isListening = true;
	vscode.window.showInformationMessage('Listening for commands...');

	const recordingStream = recorder
		.record({
			sampleRateHertz: 16000,
			threshold: 0,
			verbose: false,
			recordProgram: '/usr/bin/sox',  // was 'rec'
			silence: '10.0',
		})
		.on('error', handleStreamError);

	const recognizeStream = speechClient
		.streamingRecognize({
			config: {
				encoding: 'LINEAR16',
				sampleRateHertz: 16000,
				languageCode: 'en-US',
			},
			interimResults: false,
		})
		.on('error', handleStreamError)
		.on('data', async (data: any) => {
			const commandText = data.results[0].alternatives[0].transcript;
			const matchedCommand = await matchVSCodeCommand(commandText);

			if (matchedCommand) {
				const shouldExecute = await vscode.window.showQuickPick(['Yes', 'No'], {
					placeHolder: `Execute command: ${matchedCommand.title}?`,
				});

				if (shouldExecute === 'Yes') {
					vscode.commands.executeCommand(matchedCommand.command);
				}
			} else {
				vscode.window.showErrorMessage('No matching command found.');
			}
			isListening = false;
			recognizeStream.end();
		});

	// Pipe the audio data to the recognize stream
	recordingStream.pipe(recognizeStream);

	// Stop recording after 10 seconds
	setTimeout(() => {
		recorder.stop();
	}, 10000);
};

function handleStreamError(error: Error) {
	console.error(error);
	vscode.window.showErrorMessage(`Error: ${error.message}`);
	if (isListening) {
		recorder.stop();
		isListening = false;
	}
};

async function matchVSCodeCommand(text: string): Promise<vscode.Command | undefined> {
	const availableCommands = await vscode.commands.getCommands();
	const commandTitles: string[] = [];
	const commandMap: Map<string, vscode.Command> = new Map();

	for (const commandId of availableCommands) {
		const title = commandId.replace(/\./g, ' ');
		commandMap.set(title, { command: commandId, title });
		commandTitles.push(title);
	}

	const matchedTitle = findClosestMatch(text, commandTitles);

	if (matchedTitle) {
		return commandMap.get(matchedTitle);
	}

	return undefined;
}

function findClosestMatch(text: string, commandTitles: string[]): string | undefined {
	const matches = stringSimilarity.findBestMatch(text, commandTitles);
	const bestMatch = matches.bestMatch;

	if (bestMatch.rating > 0.7) { // You can adjust this threshold based on your preferences
		return bestMatch.target;
	}

	return undefined;
}


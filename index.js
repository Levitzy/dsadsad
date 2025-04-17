const fs = require('fs');
const path = require('path');
const login = require('ws3-fca');
const config = require('./config.json');

// Function to load commands from the cmds folder
function loadCommands() {
    const commands = new Map();
    const commandFiles = fs.readdirSync('./cmds').filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(`./cmds/${file}`);
        commands.set(command.name, command);
    }

    return commands;
}

// Initialize commands
const commands = loadCommands();

// Log in to Facebook
login({ appState: JSON.parse(fs.readFileSync('appstate.json', 'utf8')) }, (err, api) => {
    if (err) {
        console.error('Login failed!', err);
        return;
    }

    console.log('Bot logged in successfully!');

    // Set options
    api.setOptions({ listenEvents: true });

    // Listen for messages
    api.listenMqtt((err, event) => {
        if (err) return console.error(err);

        // Only handle message events
        if (event.type !== 'message') return;

        // Get message content
        const message = event.body;

        // Handle commands with prefix
        if (message.startsWith(config.prefix)) {
            const args = message.slice(config.prefix.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            if (commands.has(commandName)) {
                try {
                    commands.get(commandName).execute(api, event, args);
                } catch (error) {
                    console.error(error);
                    api.sendMessage('An error occurred while executing that command!', event.threadID);
                }
            }
        }
        // Handle commands without prefix
        else {
            const args = message.trim().split(/ +/);
            const commandName = args.shift().toLowerCase();

            if (commands.has(commandName)) {
                try {
                    commands.get(commandName).execute(api, event, args);
                } catch (error) {
                    console.error(error);
                    api.sendMessage('An error occurred while executing that command!', event.threadID);
                }
            }
        }
    });
});

// Detect new files in cmds folder and reload commands dynamically
fs.watch('./cmds', (eventType, filename) => {
    if (filename && filename.endsWith('.js')) {
        console.log(`Command file ${filename} was changed, reloading commands...`);
        try {
            delete require.cache[require.resolve(`./cmds/${filename}`)];
            const command = require(`./cmds/${filename}`);
            commands.set(command.name, command);
            console.log(`Reloaded command: ${command.name}`);
        } catch (error) {
            console.error(`Failed to reload command ${filename}:`, error);
        }
    }
});
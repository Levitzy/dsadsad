const fs = require('fs');
const path = require('path');
const login = require('ws3-fca');
const config = require('./config.json');
const { HttpsProxyAgent } = require('https-proxy-agent');
const axios = require('axios');
const https = require('https');

// Proxy functionality
function getRandomProxy() {
    if (!config.proxies || !config.proxies.length) return null;

    const randomIndex = Math.floor(Math.random() * config.proxies.length);
    const proxy = config.proxies[randomIndex];

    // Parse proxy string
    const parts = proxy.split(':');

    if (parts.length === 2) {
        // Format: ip:port
        return {
            host: parts[0],
            port: parts[1]
        };
    } else if (parts.length === 4) {
        // Format: ip:port:user:pass
        return {
            host: parts[0],
            port: parts[1],
            auth: {
                username: parts[2],
                password: parts[3]
            }
        };
    }

    return null;
}

function createProxyAgent() {
    const proxy = getRandomProxy();

    if (!proxy) return null;

    let proxyUrl;

    if (proxy.auth) {
        proxyUrl = `http://${proxy.auth.username}:${proxy.auth.password}@${proxy.host}:${proxy.port}`;
    } else {
        proxyUrl = `http://${proxy.host}:${proxy.port}`;
    }

    return new HttpsProxyAgent(proxyUrl);
}

// Create a preconfigured axios instance
function createAxiosClient(useProxy = false) {
    return axios.create({
        timeout: 30000,
        maxRedirects: 15,
        httpsAgent: useProxy ? createProxyAgent() : new https.Agent({
            rejectUnauthorized: false,
            keepAlive: true
        })
    });
}

// Make the axios client creator available globally
global.createAxiosClient = createAxiosClient;

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
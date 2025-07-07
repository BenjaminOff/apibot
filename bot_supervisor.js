const { Client, Intents } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class BotSupervisor {
    constructor() {
        this.client = new Client({
            intents: [
                Intents.FLAGS.GUILDS,
                Intents.FLAGS.GUILD_MESSAGES,
                Intents.FLAGS.MESSAGE_CONTENT
            ]
        });

        this.managedBots = new Map();
        this.prefix = '!super';

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('ready', () => {
            console.log(`Logged in as ${this.client.user.tag}`);
            this.loadManagedBots().catch(console.error);
        });

        this.client.on('messageCreate', (message) => {
            try {
                this.handleMessage(message);
            } catch (error) {
                console.error('Error handling message:', error);
                message.reply('An error occurred while processing your command.').catch(console.error);
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('Unhandled Rejection:', error);
        });
    }

    async loadManagedBots() {
        try {
            const data = await fs.readFile('managed_bots.json', 'utf-8');
            const parsedData = JSON.parse(data);
            // Normalize file paths when loading
            const normalizedEntries = Object.entries(parsedData).map(([name, info]) => [
                name,
                {
                    ...info,
                    filePath: info.filePath ? info.filePath.replace(/\\/g, '/') : info.filePath
                }
            ]);
            this.managedBots = new Map(normalizedEntries);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.managedBots = new Map();
                await this.saveManagedBots();
            } else {
                throw new Error(`Failed to load managed bots: ${error.message}`);
            }
        }
    }

    async saveManagedBots() {
        try {
            const data = Object.fromEntries(
                Array.from(this.managedBots.entries()).map(([name, info]) => [
                    name,
                    {
                        ...info,
                        filePath: info.filePath.replace(/\\/g, '/')
                    }
                ])
            );
            await fs.writeFile('managed_bots.json', JSON.stringify(data, null, 2));
        } catch (error) {
            throw new Error(`Failed to save managed bots: ${error.message}`);
        }
    }

    async handleMessage(message) {
        if (!message.content.startsWith(this.prefix) || message.author.bot) return;

        const args = message.content.slice(this.prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        try {
            switch (command) {
                case 'create_bot':
                    await this.handleCreateBot(message, args);
                    break;
                case 'start_bot':
                    await this.handleStartBot(message, args);
                    break;
                case 'stop_bot':
                    await this.handleStopBot(message, args);
                    break;
                case 'stop_all':
                    await this.handleStopAllBots(message);
                    break;
                case 'list_bots':
                    await this.handleListBots(message);
                    break;
                case 'help':
                    await this.handleHelp(message, args);
                    break;
                default:
                    await message.reply('Commande inconnue. Utilisez !super help pour voir les commandes disponibles.');
            }
        } catch (error) {
            console.error(`Error executing command ${command}:`, error);
            await message.reply(`Failed to execute command: ${error.message}`);
        }
    }

    async handleStopAllBots(message) {
        if (!message.member.permissions.has(0x8)) {
            throw new Error('Vous avez besoin des permissions administrateur pour utiliser cette commande !');
        }

        const runningBots = Array.from(this.managedBots.entries())
            .filter(([_, info]) => info.status === 'running');

        if (runningBots.length === 0) {
            await message.reply('Aucun bot n\'est actuellement en cours d\'exécution.');
            return;
        }

        try {
            // Sur Windows, on doit tuer l'arbre des processus
            const killCommand = process.platform === 'win32' ? 'taskkill' : 'pkill';
            const killArgs = process.platform === 'win32' ? ['/F', '/IM', 'node.exe'] : ['-f', 'node'];
            
            spawn(killCommand, killArgs, { shell: true });

            // Mettre à jour le statut de tous les bots
            for (const [name, info] of runningBots) {
                info.status = 'stopped';
            }

            await this.saveManagedBots();
            await message.reply(`${runningBots.length} bot(s) ont été arrêtés avec succès.`);
        } catch (error) {
            throw new Error(`Échec de l'arrêt des bots : ${error.message}`);
        }
    }

    async handleHelp(message, args) {
        const command = args[0]?.toLowerCase();
        
        const helpMessages = {
            'list_bots': {
                description: 'Affiche la liste de tous les bots gérés et leur statut',
                usage: '!super list_bots',
                example: '!super list_bots',
                permissions: 'Aucune permission spéciale requise'
            },
            'create_bot': {
                description: 'Crée un nouveau bot Discord',
                usage: '!super create_bot <nom_du_bot> <token>',
                example: '!super create_bot MonBot TOKEN_ICI',
                permissions: 'Administrateur'
            },
            'start_bot': {
                description: 'Démarre un bot existant',
                usage: '!super start_bot <nom_du_bot>',
                example: '!super start_bot MonBot',
                permissions: 'Administrateur'
            },
            'stop_bot': {
                description: 'Arrête un bot en cours d\'exécution',
                usage: '!super stop_bot <nom_du_bot>',
                example: '!super stop_bot MonBot',
                permissions: 'Administrateur'
            },
            'stop_all': {
                description: 'Arrête tous les bots en cours d\'exécution',
                usage: '!super stop_all',
                example: '!super stop_all',
                permissions: 'Administrateur'
            }
        };

        if (command && helpMessages[command]) {
            const help = helpMessages[command];
            await message.reply(`
**Aide pour la commande ${command}**
📝 Description: ${help.description}
🔧 Utilisation: ${help.usage}
📋 Exemple: ${help.example}
🔑 Permissions: ${help.permissions}
`);
        } else {
            await message.reply(`
**Commandes disponibles:**
• \`list_bots\` - Affiche la liste des bots gérés
• \`create_bot\` - Crée un nouveau bot (Admin uniquement)
• \`start_bot\` - Démarre un bot existant (Admin uniquement)

Pour plus de détails sur une commande spécifique, utilisez \`!super help <commande>\`
`);
        }
    }

    async handleCreateBot(message, args) {
        if (!message.member.permissions.has(0x8)) {
            throw new Error('You need administrator permissions to use this command!');
        }

        const [botName, token] = args;
        if (!botName || !token) {
            throw new Error('Please provide both bot name and token!');
        }

        await this.createBot(message, botName, token);
    }

    async handleStartBot(message, args) {
        if (!message.member.permissions.has(0x8)) {
            throw new Error('You need administrator permissions to use this command!');
        }

        const [botName] = args;
        if (!botName) {
            throw new Error('Please provide the bot name!');
        }

        await this.startBot(message, botName);
    }

    async handleStopBot(message, args) {
        if (!message.member.permissions.has(0x8)) {
            throw new Error('You need administrator permissions to use this command!');
        }

        const [botName] = args;
        if (!botName) {
            throw new Error('Please provide the bot name!');
        }

        await this.stopBot(message, botName);
    }

    async handleListBots(message) {
        const botList = Array.from(this.managedBots.entries())
            .map(([name, info]) => `${name}: ${info.status}`)
            .join('\n');

        await message.reply(
            this.managedBots.size > 0
                ? `Managed Bots:\n\`\`\`\n${botList}\n\`\`\``
                : 'No bots are currently managed.'
        );
    }

    async createBot(message, botName, token) {
        if (this.managedBots.has(botName)) {
            throw new Error(`Bot ${botName} already exists!`);
        }

        const botDir = path.join('bots', botName);
        const sourceDir = path.join('bots', 'az');
        const azBotsDir = path.join('bots', 'az', 'bots');
        const azBotsFile = path.join(azBotsDir, 'index.js'); // Change filename if needed
        try {
            // Copy az template
            await fs.cp(sourceDir, botDir, { recursive: true });

            // Ensure /bots/az/bots/ exists
            await fs.mkdir(azBotsDir, { recursive: true });
            // Create a file in /bots/az/bots/
            await fs.writeFile(azBotsFile, '// Bot entry point for az');

            // Update token in config.json
            const configPath = path.join(botDir, 'config.json');
            const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
            config.token = token;
            await fs.writeFile(configPath, JSON.stringify(config, null, 2));

            this.managedBots.set(botName, {
                token,
                status: 'stopped',
                filePath: path.join(botDir, 'index.js')
            });

            await this.saveManagedBots();
            await message.reply(`Bot ${botName} a été créé avec succès en utilisant le template D'Azurix !`);
        } catch (error) {
            throw new Error(`Échec de la création du bot depuis le template Azurix : ${error.message}`);
        }
    }

    async startBot(message, botName) {
        const bot = this.managedBots.get(botName);
        if (!bot) {
            throw new Error(`Le bot ${botName} n'existe pas !`);
        }

        if (bot.status === 'running') {
            throw new Error(`Le bot ${botName} est déjà en cours d'exécution !`);
        }

        // Normalize filePath to use forward slashes
        const normalizedFilePath = bot.filePath.replace(/\\/g, '/');
        const botDir = path.dirname(normalizedFilePath);

        try {
            // Vérifier si package.json existe
            const packageJsonPath = path.join(botDir, 'package.json');
            try {
                await fs.access(packageJsonPath);
            } catch (error) {
                throw new Error(`Le fichier package.json est manquant dans ${botDir}`);
            }

            // Installer les dépendances avec plus d'options
            await new Promise((resolve, reject) => {
                const npmInstall = spawn('npm', ['install', '--legacy-peer-deps', '--force'], {
                    cwd: botDir,
                    shell: true,
                    stdio: 'inherit',
                    env: { ...process.env, NODE_ENV: 'development' }
                });
                
                npmInstall.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`npm install a échoué avec le code ${code}. Vérifiez que Node.js et npm sont correctement installés.`));
                });

                npmInstall.on('error', (error) => {
                    reject(new Error(`Erreur lors de l'installation des dépendances : ${error.message}`));
                });
            });

            // Démarrer le bot avec la sortie visible
            const botProcess = spawn('node', [normalizedFilePath], {
                cwd: botDir,
                shell: true,
                stdio: 'inherit',
                env: { ...process.env, NODE_ENV: 'production' }
            });

            botProcess.on('error', (error) => {
                console.error(`Erreur lors du démarrage du bot ${botName}:`, error);
                message.reply(`Erreur lors du démarrage du bot ${botName}: ${error.message}`).catch(console.error);
            });

            bot.status = 'running';
            await this.saveManagedBots();
            await message.reply(`Le bot ${botName} a été démarré !`);
        } catch (error) {
            throw new Error(`Échec du démarrage du bot ${botName}: ${error.message}`);
        }
    }

    async createBotFiles(botDir, botName, token) {
        const botCode = this.generateBotCode(botName, token);
        const packageJson = this.generatePackageJson(botName);

        await Promise.all([
            fs.writeFile(path.join(botDir, 'bot.js'), botCode),
            fs.writeFile(path.join(botDir, 'package.json'), JSON.stringify(packageJson, null, 2))
        ]);
    }

    generateBotCode(botName, token) {
        return `
const { Client, Intents } = require('discord.js');  // Changed to use Intents instead of GatewayIntentBits

const client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.MESSAGE_CONTENT
    ]
});

const prefix = '!${botName}';

client.on('ready', () => {
    console.log(\`Logged in as \${client.user.tag}\`);
});

client.on('messageCreate', message => {
    try {
        if (!message.content.startsWith(prefix) || message.author.bot) return;

        const args = message.content.slice(prefix.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        if (command === 'hello') {
            message.reply('Hello! I am ${botName}!');
        }
    } catch (error) {
        console.error('Error handling message:', error);
        message.reply('An error occurred while processing your command.').catch(console.error);
    }
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

client.login('${token}').catch(console.error);
`;
    }

    generatePackageJson(botName) {
        return {
            name: botName,
            version: '1.0.0',
            main: 'bot.js',
            dependencies: {
                'discord.js': '^14.11.0'
            }
        };
    }

    start(token) {
        this.client.login(token).catch(console.error);
    }

    async handleStopBot(message, args) {
        if (!message.member.permissions.has(PermissionFlagBits.Administrator)) {
            throw new Error('You need administrator permissions to use this command!');
        }

        const [botName] = args;
        if (!botName) {
            throw new Error('Please provide the bot name!');
        }

        await this.stopBot(message, botName);
    }

    async stopBot(message, botName) {
        const bot = this.managedBots.get(botName);
        if (!bot) {
            throw new Error(`Bot ${botName} doesn't exist!`);
        }

        if (bot.status !== 'running') {
            throw new Error(`Bot ${botName} is not running!`);
        }

        try {
            // On Windows, we need to kill the process tree
            const killCommand = process.platform === 'win32' ? 'taskkill' : 'pkill';
            const killArgs = process.platform === 'win32' ? ['/F', '/IM', 'node.exe'] : ['-f', 'node'];
            
            spawn(killCommand, killArgs, { shell: true });

            bot.status = 'stopped';
            await this.saveManagedBots();
            await message.reply(`Bot ${botName} has been stopped!`);
        } catch (error) {
            throw new Error(`Failed to stop bot ${botName}: ${error.message}`);
        }
    }
}

module.exports = BotSupervisor;
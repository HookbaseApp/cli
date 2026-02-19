import * as api from '../lib/api.js';
import * as config from '../lib/config.js';
import * as logger from '../lib/logger.js';

function readHiddenInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let input = '';

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char: string) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        console.log();
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.exit();
      } else if (char === '\u007F' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

export async function loginCommand(): Promise<void> {
  // Check if already logged in
  if (config.isAuthenticated()) {
    const user = config.getCurrentUser();
    logger.info(`Already logged in as ${user?.email}`);
    logger.info('Run "hookbase logout" to switch accounts');
    return;
  }

  try {
    logger.log('');
    logger.log(logger.bold('  Hookbase CLI Login'));
    logger.log('');
    logger.log('  Enter your API key from: https://www.hookbase.app/settings');
    logger.log('');

    const apiKey = await readHiddenInput('API Key: ');

    if (!apiKey || !apiKey.trim()) {
      logger.error('API key is required');
      return;
    }

    if (!apiKey.trim().startsWith('whr_')) {
      logger.error('Invalid API key format. API keys start with "whr_".');
      logger.dim('Get your API key from: https://www.hookbase.app/settings');
      return;
    }

    const spinner = logger.spinner('Verifying API key...');

    // Verify the API key by calling /auth/me
    const result = await api.verifyApiKey(apiKey.trim());

    if (result.error || !result.data) {
      spinner.fail('Invalid API key');
      logger.error(result.error || 'Could not verify API key');
      return;
    }

    const { user, organizations } = result.data;

    // Save credentials
    config.setAuth(apiKey.trim(), user.id, user.email, user.displayName);

    // Set first organization as default
    if (organizations.length > 0) {
      const org = organizations[0];
      config.setCurrentOrg(org.id, org.slug);
    }

    spinner.succeed(`Logged in as ${user.email}`);

    // Show organizations
    if (organizations.length > 0) {
      logger.log('');
      logger.info('Your organizations:');
      for (const org of organizations) {
        const current = org.id === config.getCurrentOrg()?.id ? logger.green(' (current)') : '';
        logger.log(`  • ${org.name} (${org.slug})${current}`);
      }
    }

    logger.log('');
    logger.dim('Configuration saved to: ' + config.getConfigPath());
  } catch (err) {
    logger.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

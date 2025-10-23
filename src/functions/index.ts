import chalk from 'chalk';

// Ícones
const icons = {
  info: chalk.blue('ℹ️'),
  success: chalk.green('✓'),
  warn: chalk.yellow('▲'),
  error: chalk.red('✖︎'),
  database: chalk.cyan('💾'),
  api: chalk.magenta('☁️'),
  process: chalk.yellow('⚙️'),
  debug: chalk.gray('🐞'),
  env: chalk.magenta('☰'),
};

// Função base
function logMessage(
  icon: string,
  commandName: string | null,
  message: string,
  ...optionalParams: any[]
) {
  const commandTag = commandName ? chalk.dim(`[${commandName}]`) : '';
  console.log(`${icon} ${commandTag} ${message}`, ...optionalParams);
}

// Objeto logger exportado
export const logger = {
  info: (command: string, message: string, ...args: any[]) =>
    logMessage(icons.info, command, message, ...args),
  success: (command: string, message: string, ...args: any[]) =>
    logMessage(icons.success, command, message, ...args),
  warn: (command: string, message: string, ...args: any[]) =>
    logMessage(icons.warn, command, message, ...args),
  error: (command: string, message: string, error?: any, ...args: any[]) => {
    logMessage(icons.error, command, chalk.red(message), ...args);
    if (error) {
      // Loga apenas a mensagem do erro ou o objeto se não tiver mensagem
      const errorMessage = error instanceof Error ? error.message : error;
      console.error(chalk.red(`  └─> ${errorMessage}`));
      console.error(error);
    }
  },
  db: (command: string, message: string, ...args: any[]) =>
    logMessage(icons.database, command, message, ...args),
  api: (command: string, message: string, ...args: any[]) =>
    logMessage(icons.api, command, message, ...args),
  process: (command: string, message: string, ...args: any[]) =>
    logMessage(icons.process, command, message, ...args),
  // Log para inicialização de módulos/clientes
  system: (moduleName: string, message: string, success: boolean = true) =>
    logMessage(
      success ? icons.success : icons.error,
      null,
      `${chalk.yellow(moduleName)}: ${message}`
    ),
  // Log para variáveis de ambiente
  env: (message: string) =>
    console.log(
      chalk.green(
        `${icons.env} ${chalk.magenta('Environment variables')}: ${message} ✓`
      )
    ),
};

export const logEnvError = {
  var: (variable: string, message: string) =>
    console.error(
      `${icons.error} ENV VAR → ${chalk.underline.bold(variable)} ${message}`
    ),
  type: (_variable: string, expected: string, received: any) =>
    console.log(
      chalk.dim(
        `  └─> Expected: ${chalk.green(expected)} | Received: ${chalk.red(
          received
        )}`
      )
    ),
};

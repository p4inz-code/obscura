/**
 * Obscura CLI — packages/cli/src/cli.ts
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, basename, extname, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  generate,
  runPipeline,
  RenameTransform,
  StringTransform,
  ConstantTransform,
  DeadCodeTransform,
  type ObscuraParseResult,
  type PipelineStep,
  type StringEncoding,
  type NumberEncoding,
} from '@obscura/core';

const VERSION = '0.0.1-dev';

interface CliArgs {
  command: 'build' | 'help' | 'version';
  inputFile: string | null;
  outputFile: string | null;
  transforms: Set<string>;
  stringEncoding: StringEncoding;
  numberEncoding: NumberEncoding;
  deadCodeRate: number;
  seed: number;
  dryRun: boolean;
  verbose: boolean;
}

function makeArgs(command: CliArgs['command']): CliArgs {
  return {
    command,
    inputFile: null,
    outputFile: null,
    transforms: new Set(['rename', 'string', 'constant', 'dead-code']),
    stringEncoding: 'decimal',
    numberEncoding: 'mixed',
    deadCodeRate: 0.3,
    seed: 0,
    dryRun: false,
    verbose: false,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') return makeArgs('help');
  if (args[0] === '--version' || args[0] === '-v') return makeArgs('version');
  if (args[0] !== 'build') {
    printError(`Unknown command '${args[0]}'. Use 'obscura --help'.`);
    process.exit(1);
  }

  const result = makeArgs('build');
  let i = 1;
  while (i < args.length) {
    const arg = args[i]!;
    switch (arg) {
      case '-o':
      case '--output':
        result.outputFile = args[++i] ?? null;
        break;
      case '--transforms':
        result.transforms = new Set((args[++i] ?? '').split(',').map(s => s.trim()));
        break;
      case '--no-rename':
        result.transforms.delete('rename');
        break;
      case '--no-string':
        result.transforms.delete('string');
        break;
      case '--no-constant':
        result.transforms.delete('constant');
        break;
      case '--no-dead-code':
        result.transforms.delete('dead-code');
        break;
      case '--string-encoding':
        result.stringEncoding = (args[++i] ?? 'decimal') as StringEncoding;
        break;
      case '--number-encoding':
        result.numberEncoding = (args[++i] ?? 'mixed') as NumberEncoding;
        break;
      case '--dead-code-rate':
        result.deadCodeRate = parseFloat(args[++i] ?? '0.3');
        break;
      case '--seed':
        result.seed = parseInt(args[++i] ?? '0', 10);
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--verbose':
      case '--debug':
        result.verbose = true;
        break;
      default:
        if (arg.startsWith('-')) {
          printError(`Unknown option '${arg}'.`);
          process.exit(1);
        }
        result.inputFile = arg;
    }
    i++;
  }
  if (!result.inputFile) {
    printError('No input file specified.');
    process.exit(1);
  }
  return result;
}

function parseSource(source: string, sourceFile: string): ObscuraParseResult {
  const __dir = fileURLToPath(new URL('.', import.meta.url));
  const nativeBin =
    process.env['OBSCURA_NATIVE_BIN'] ?? resolve(__dir, '../../../luau/build/obscura_native');

  const dir = resolve(tmpdir(), `obscura-cli-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const tmp = resolve(dir, 'input.luau');
  try {
    writeFileSync(tmp, source, 'latin1');
    const out = execFileSync(nativeBin, [tmp], { timeout: 10000, maxBuffer: 32 * 1024 * 1024 });
    const result = JSON.parse(out.toString('utf-8')) as ObscuraParseResult;
    if (result.errors.length > 0) {
      const errs = result.errors
        .map(
          e =>
            `  ${sourceFile}:${e.location.begin.line + 1}:${e.location.begin.column + 1}: ${e.message}`,
        )
        .join('\n');
      printError(`Parse errors:\n${errs}`);
      process.exit(1);
    }
    return result;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function printError(msg: string): void {
  process.stderr.write(`\x1b[31mError:\x1b[0m ${msg}\n`);
}
function printSuccess(msg: string): void {
  process.stdout.write(`\x1b[32m✓\x1b[0m ${msg}\n`);
}
function printInfo(msg: string): void {
  process.stdout.write(`  ${msg}\n`);
}

function printHelp(): void {
  console.log(`
Obscura — Professional Luau Source Protection Toolkit v${VERSION}
Free forever. Open source. No subscriptions.

USAGE:
  obscura build <file.luau> [options]

OPTIONS:
  -o, --output <file>        Output file (default: <input>.obf.luau)
  --transforms <list>        Comma-separated: rename,string,constant,dead-code
  --no-rename                Disable variable renaming
  --no-string                Disable string encoding
  --no-constant              Disable constant obfuscation
  --no-dead-code             Disable dead code insertion
  --string-encoding <mode>   decimal | hex | split  (default: decimal)
  --number-encoding <mode>   arithmetic | bitwise | mixed  (default: mixed)
  --dead-code-rate <0-1>     Insertion rate (default: 0.3)
  --seed <n>                 Deterministic seed (default: 0)
  --dry-run                  Print to stdout, don't write file
  --verbose                  Show transform stats
  -v, --version              Show version
  -h, --help                 Show this help

EXAMPLES:
  obscura build game.luau
  obscura build game.luau -o game.protected.luau --verbose
  obscura build game.luau --no-dead-code --string-encoding hex
  obscura build game.luau --transforms rename,string
  obscura build game.luau --dry-run
`);
}

// Kept async deliberately so all errors funnel through main().catch() below,
// even though no branch currently awaits anything.
// eslint-disable-next-line @typescript-eslint/require-await
async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.command === 'help') {
    printHelp();
    return;
  }
  if (args.command === 'version') {
    console.log(`obscura v${VERSION}`);
    return;
  }

  const inputPath = resolve(process.cwd(), args.inputFile!);
  let source: string;
  try {
    source = readFileSync(inputPath, 'latin1');
  } catch {
    printError(`Cannot read '${inputPath}'.`);
    process.exit(1);
  }

  if (args.verbose) printInfo('Parsing…');
  const parsed = parseSource(source!, args.inputFile!);

  const steps: PipelineStep[] = [];
  if (args.transforms.has('rename')) steps.push({ transform: RenameTransform });
  if (args.transforms.has('string'))
    steps.push({ transform: StringTransform, options: { encoding: args.stringEncoding } });
  if (args.transforms.has('constant'))
    steps.push({
      transform: ConstantTransform,
      options: { numberEncoding: args.numberEncoding, seed: args.seed },
    });
  if (args.transforms.has('dead-code'))
    steps.push({
      transform: DeadCodeTransform,
      options: { insertionRate: args.deadCodeRate, seed: args.seed },
    });

  if (steps.length === 0) {
    printError('No transforms enabled.');
    process.exit(1);
  }

  if (args.verbose) printInfo(`Running ${steps.length} transform(s)…`);
  const pipeline = runPipeline(parsed, steps);
  const output = generate(pipeline.result);

  if (args.verbose) {
    for (const step of pipeline.steps) {
      const s = Object.entries(step.stats)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ');
      printInfo(`${step.name}: ${s}`);
    }
  }

  if (args.dryRun) {
    process.stdout.write(output);
    return;
  }

  const outPath =
    args.outputFile ??
    resolve(dirname(inputPath), basename(inputPath, extname(inputPath)) + '.obf.luau');

  writeFileSync(outPath, output, 'utf-8');

  const inSize = Buffer.byteLength(source!, 'latin1');
  const outSize = Buffer.byteLength(output, 'utf-8');
  printSuccess(
    `${basename(inputPath)} → ${basename(outPath)} (${inSize}B → ${outSize}B, ${((outSize / inSize) * 100).toFixed(0)}%)`,
  );
}

main().catch(e => {
  printError(String(e));
  process.exit(1);
});

import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';

/* Repeated in the *.ts block, whose typescript-eslint recommended config
 * would otherwise reset these levels */
const rules = {
    /* Names that come from GObject or GJS (properties, vfunc_*) stay
     * snake_case, so only our own variables and functions are checked */
    '@typescript-eslint/naming-convention': [
        'warn',
        {
            selector: ['variable', 'parameter', 'function'],
            format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
            leadingUnderscore: 'allow',
        },
    ],
    /* Allow unused variables starting with underscores */
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
        'warn',
        {
            varsIgnorePattern: '^_',
            argsIgnorePattern: '^_',
            destructuredArrayIgnorePattern: '^_',
            caughtErrorsIgnorePattern: '^_',
        },
    ],
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
};

const tsFiles = ['**/*.ts', '**/*.tsx'];

export default [
    {
        ignores: ['node_modules/', 'dist/', 'build/', '@gi-types/'],
    },
    js.configs.recommended,
    /* What plugin:prettier/recommended did. eslint-plugin-prettier 5 ships
     * a flat config, but it needs Prettier 3. */
    prettierConfig,
    {
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            prettier: prettierPlugin,
        },
        languageOptions: {
            parser: tseslint.parser,
            globals: {
                ARGV: false,
                Debugger: false,
                GIRepositoryGType: false,
                imports: false,
                Intl: false,
                logError: false,
                print: false,
                printerr: false,
                TextDecoder: false,
                window: false,
                global: false,
                _: false,
                C_: false,
                N_: false,
                ngettext: false,
            },
        },
        rules: Object.assign(
            {
                'prettier/prettier': 'error',
                'arrow-body-style': 'off',
                'prefer-arrow-callback': 'off',
            },
            rules
        ),
    },
    ...tseslint.configs.recommended.map((config) =>
        Object.assign({}, config, { files: tsFiles })
    ),
    {
        files: tsFiles,
        languageOptions: {
            ecmaVersion: 2020,
            parserOptions: {
                project: ['./tsconfig.json'],
            },
        },
        rules,
    },
];

/* eslint-env node */

/* Repeated in the *.ts override, whose plugin:@typescript-eslint/recommended
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
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
};

module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    env: {
        es6: true,
    },
    extends: ['eslint:recommended', 'plugin:prettier/recommended'],
    plugins: ['@typescript-eslint'],
    rules,
    overrides: [
        {
            files: ['*.ts', '*.tsx'],

            extends: [
                'plugin:@typescript-eslint/recommended',
                // 'plugin:@typescript-eslint/strict',
                // 'plugin:@typescript-eslint/recommended-requiring-type-checking',
            ],

            rules,

            parserOptions: {
                project: ['./tsconfig.json'],
                ecmaVersion: 2020,
            },
        },
    ],
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
};

const globals = require('globals');
const pluginJs = require('@eslint/js');

module.exports = [
    {
        files: ["**/*.js"],
        languageOptions: {
            sourceType: "commonjs",
            globals: {
                ...globals.node,
            }
        },
        ...pluginJs.configs.recommended,
    },
    {
        files: ["public/**/*.js"],
        languageOptions: {
            sourceType: "script",
            globals: {
                ...globals.browser,
            }
        },
        ...pluginJs.configs.recommended,
    },
    {
        ignores: ["node_modules/", "uploaded_files/"]
    }
];

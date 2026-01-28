export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleFileExtensions: ['ts', 'js'],
    transform: {
        '^.+\\.ts$': 'ts-jest',
    },
    testMatch: ['**/tests/**/*.test.ts'],
    testPathIgnorePatterns: ['/node_modules/'],
    moduleNameMapper: {
        "^obsidian$": "<rootDir>/tests/__mocks__/obsidian.ts"
    }
};

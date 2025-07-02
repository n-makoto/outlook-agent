# Publishing to npm

This guide explains how to publish outlook-agent to npm so it can be used with npx.

## Prerequisites

1. Create an npm account at https://www.npmjs.com/signup
2. Login to npm from command line:
   ```bash
   npm login
   ```

## Publishing Steps

1. **Ensure the code is built:**
   ```bash
   npm run build
   ```

2. **Check what files will be published:**
   ```bash
   npm pack --dry-run
   ```

3. **Publish to npm:**
   ```bash
   npm publish
   ```

## After Publishing

Users can now run the tool without installation:
```bash
npx outlook-agent --help
```

## Version Updates

When making updates:

1. Update the version in package.json:
   ```bash
   npm version patch  # for bug fixes
   npm version minor  # for new features
   npm version major  # for breaking changes
   ```

2. Build and publish:
   ```bash
   npm run build
   npm publish
   ```

## Testing npx Locally

Before publishing, you can test npx behavior locally:

```bash
# In the project directory
npm link

# In another directory
npx outlook-agent --help
```
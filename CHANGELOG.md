# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-01-14

### Added
- AI-powered schedule conflict analysis using OpenAI SDK
- Batch approval workflow for efficient conflict resolution
- Selective modification feature with checkbox UI
- Customizable AI instructions via YAML configuration
- Special rules support for ignoring specific conflict combinations
- Priority-based conflict resolution system
- Decision memory and learning patterns for improved suggestions
- Support for multiple OpenAI models (gpt-4o-mini, gpt-4o, o1-mini, o1-preview)
- Comprehensive documentation for agent commands

### Changed
- Improved UX from one-by-one approval to batch processing
- Updated default AI model from gpt-4-turbo to gpt-4o-mini
- Enhanced conflict detection with configurable ignore rules
- Refactored agent architecture to support both AI and rule-based decisions

### Fixed
- Mastra package compatibility issues with Node.js v22
- TypeScript compilation errors with js-yaml types

## [0.1.0] - 2025-01-13

### Added
- Initial release with basic Outlook calendar management
- Microsoft Graph CLI (mgc) integration
- Calendar viewing and event management
- Basic conflict detection
- Reschedule and decline commands
- NPM package support with npx execution
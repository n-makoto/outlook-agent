# Agent Commands Documentation

## Overview
The `agent` command group provides AI-powered scheduling automation features for Outlook calendar management.

## Commands

### agent schedule-week

Analyzes your weekly calendar and automatically suggests solutions for scheduling conflicts.

```bash
npx outlook-agent agent schedule-week [options]
```

#### Options

- `-d, --dry-run` - Preview changes without applying them
- `--date <date>` - Start date for the week (YYYY-MM-DD format)
- `--json` - Output in JSON format for programmatic use
- `--rules <file>` - Path to custom scheduling rules YAML file (default: prompts/scheduling-rules.yaml)
- `--instructions <file>` - Path to custom AI instructions YAML file (default: prompts/ai-instructions.yaml)

#### Examples

```bash
# Analyze current week's conflicts (dry-run mode)
npx outlook-agent agent schedule-week --dry-run

# Analyze specific week
npx outlook-agent agent schedule-week --date 2025-01-20

# Export conflicts as JSON
npx outlook-agent agent schedule-week --json > conflicts.json

# Use custom rules
npx outlook-agent agent schedule-week --rules my-rules.yaml
```

## Features

### Priority-Based Conflict Resolution

The agent analyzes conflicts based on:
- Meeting title patterns
- Number of attendees
- Organizer importance
- Regular vs one-time meetings
- Custom priority rules

### Priority Levels

1. **Critical (Score: 100)**
   - CEO/Executive 1on1s
   - Final interviews
   - Customer meetings

2. **High (Score: 75)**
   - Team meetings
   - Project reviews
   - Meetings with 5+ attendees

3. **Medium (Score: 50)**
   - Regular 1on1s
   - Sync meetings
   - Alignment discussions

4. **Low (Score: 25)**
   - Optional meetings
   - FYI sessions
   - Information sharing

### Learning System

The agent learns from your decisions:
- Records approval/rejection patterns
- Suggests rules based on past decisions
- Shows statistics and trends
- Improves suggestions over time

### Customization

#### Scheduling Rules (prompts/scheduling-rules.yaml)

Customize priority rules, buffer times, and conflict resolution policies.

#### AI Instructions (prompts/ai-instructions.yaml)

Customize:
- AI behavior and tone
- Output format
- Analysis depth
- Language preferences
- Custom business rules

## Environment Variables

- `OUTLOOK_AGENT_TIMEZONE` - Default timezone (e.g., "Asia/Tokyo")
- `OUTLOOK_AGENT_MODEL` - AI model to use (default: "gpt-4-turbo")
- `OPENAI_API_KEY` - Required for AI-powered analysis

## Data Storage

- `~/.outlook-agent/config.json` - Agent configuration
- `~/.outlook-agent/decisions/` - Decision history (JSONL format)
- `~/.outlook-agent/feedback/` - User feedback data

## Workflow

1. **Analysis Phase**
   - Fetches upcoming events
   - Detects conflicts
   - Calculates priorities

2. **Suggestion Phase**
   - Generates resolution proposals
   - Applies learning patterns
   - Creates structured recommendations

3. **Approval Phase**
   - Interactive review of suggestions
   - Manual modification options
   - One-click approval

4. **Execution Phase**
   - Applies approved changes
   - Updates calendar events
   - Records decisions for learning

5. **Learning Phase**
   - Analyzes decision patterns
   - Updates statistics
   - Suggests rule improvements
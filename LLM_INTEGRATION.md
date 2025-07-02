# LLM Integration Guide

This document explains how outlook-agent is designed to work with LLMs like Claude, particularly using the `claude -p` pattern.

## Design Principles

outlook-agent is designed with LLM integration in mind:

1. **Structured Output**: All commands output structured, parseable information
2. **Non-Interactive Options**: Every interactive command has non-interactive alternatives
3. **JSON Export**: Data can be exported in JSON format for easy parsing
4. **Clear Error Messages**: Errors are descriptive and actionable

## Usage with Claude

### Basic Pattern

```bash
# Use outlook-agent to provide calendar context to Claude
npx outlook-agent calendar view --date 2025-01-15 | claude -p "What meetings do I have tomorrow and should I prepare for any of them?"

# Get availability information for scheduling
npx outlook-agent calendar create --find-slot --non-interactive | claude -p "When am I free this week for a 2-hour strategy session?"
```

### Advanced Integration

#### 1. Calendar Analysis

```bash
# Export calendar data and analyze patterns
npx outlook-agent calendar view --week --json | claude -p "Analyze my meeting patterns this week. Am I spending too much time in meetings?"
```

#### 2. Contact Management

```bash
# Analyze contact interactions
npx outlook-agent contacts export -f json | claude -p "Who are my most frequent meeting participants? Suggest people I should connect with more often."
```

#### 3. Meeting Preparation

```bash
# Get context for upcoming meetings
npx outlook-agent calendar view --date tomorrow --json | claude -p "For each meeting tomorrow, suggest key talking points based on the attendees and meeting titles."
```

## Extension Points

### 1. JSON Output Mode

To make the tool more LLM-friendly, we can add `--json` flags to all commands:

```typescript
// In src/commands/calendar/view.ts
if (options.json) {
  console.log(JSON.stringify(events, null, 2));
  return;
}
```

### 2. Non-Interactive Mode

For commands that currently require interaction, add non-interactive alternatives:

```typescript
// In src/commands/calendar/create.ts
if (options.nonInteractive) {
  const eventData = {
    subject: options.subject,
    attendees: options.attendees?.split(','),
    duration: options.duration,
    // ... other fields
  };
  // Process without prompts
}
```

### 3. Structured Error Output

Ensure all errors are structured for LLM parsing:

```typescript
if (options.json && error) {
  console.log(JSON.stringify({
    error: true,
    message: error.message,
    code: error.code,
    suggestion: getSuggestion(error)
  }));
}
```

### 4. Batch Operations

Add batch operation support for LLM-driven workflows:

```typescript
// New command: outlook-agent batch
// Accepts JSON input with multiple operations
const operations = JSON.parse(options.input);
for (const op of operations) {
  await executeOperation(op);
}
```

## Example LLM Prompts

### 1. Smart Scheduling Assistant

```bash
#!/bin/bash
# smart-schedule.sh
CALENDAR_DATA=$(npx outlook-agent calendar view --week --json)
CONTACTS_DATA=$(npx outlook-agent contacts export -f json)

echo "$CALENDAR_DATA" | claude -p "
Based on my calendar, suggest optimal times for:
1. Deep work sessions (2+ hour blocks)
2. Quick sync meetings (30 min)
3. Lunch breaks

Consider my meeting patterns and avoid scheduling during typical meeting times.
"
```

### 2. Meeting Analytics

```bash
#!/bin/bash
# meeting-analytics.sh
LAST_MONTH=$(npx outlook-agent calendar view --days 30 --json)

echo "$LAST_MONTH" | claude -p "
Analyze my meetings from the last 30 days:
1. Total time in meetings
2. Most frequent collaborators
3. Meeting distribution by day/time
4. Suggestions for optimizing my calendar
"
```

### 3. Contact Insights

```bash
#!/bin/bash
# contact-insights.sh
CONTACTS=$(npx outlook-agent contacts export -f json)
RECENT_MEETINGS=$(npx outlook-agent calendar view --days 90 --json)

echo "$CONTACTS$RECENT_MEETINGS" | claude -p "
Based on my contacts and recent meetings:
1. Identify key stakeholders I meet with regularly
2. Suggest people I haven't connected with recently
3. Recommend new connections based on meeting patterns
"
```

## Future Enhancements

### 1. Webhook Support

Add webhook support for real-time LLM integration:

```typescript
// Send calendar changes to LLM endpoint
outlook-agent watch --webhook https://llm-endpoint/calendar-update
```

### 2. Plugin System

Create a plugin system for custom LLM integrations:

```typescript
// ~/.outlook-agent/plugins/claude-integration.js
export function processEvent(event) {
  // Custom logic for LLM processing
}
```

### 3. Natural Language Commands

Add natural language command parsing:

```bash
npx outlook-agent nlp "Schedule a meeting with John next week for 30 minutes"
# Translates to: outlook-agent calendar create --attendees john@example.com --duration 30 --find-slot
```

## Best Practices

1. **Use JSON output** for reliable parsing
2. **Include error handling** in your scripts
3. **Cache frequently used data** to reduce API calls
4. **Respect rate limits** when making batch requests
5. **Test prompts** with sample data before production use

## Security Considerations

1. **Sanitize output** before sending to LLMs
2. **Avoid sending sensitive information** in prompts
3. **Use environment variables** for API keys
4. **Implement access controls** for shared scripts
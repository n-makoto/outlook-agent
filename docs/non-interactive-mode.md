# Non-Interactive Mode for AI Automation

The `outlook-agent` CLI now supports a non-interactive mode for the calendar create command, enabling AI systems to autonomously find available meeting slots and gather feedback.

## Usage

### Basic Command Structure
```bash
npx outlook-agent calendar create --non-interactive \
  --subject "Meeting Title" \
  --attendees "email1@example.com,email2@example.com" \
  --duration 30 \
  --output-format json
```

### Parameters
- `--non-interactive` (`-n`): Enable non-interactive mode
- `--subject` (`-s`): Meeting subject (required)
- `--attendees` (`-a`): Comma-separated list of attendee emails (required)
- `--duration` (`-d`): Meeting duration in minutes (default: 30)
- `--output-format` (`-o`): Output format - `json` or `text` (default: text)

## Examples

### Text Output (Human-Readable)
```bash
npx outlook-agent calendar create -n \
  -s "Team Sync" \
  -a "alice@example.com,bob@example.com" \
  -d 60
```

Output:
```
Found 15 available time slots:
1. Mon, Jul 8 10:00-11:00 JST
2. Mon, Jul 8 11:00-12:00 JST
3. Mon, Jul 8 14:00-15:00 JST
...
```

### JSON Output (AI-Friendly)
```bash
npx outlook-agent calendar create -n \
  -s "Project Review" \
  -a "team@example.com" \
  -d 30 \
  -o json
```

Output:
```json
{
  "success": true,
  "subject": "Project Review",
  "attendees": ["team@example.com"],
  "duration": 30,
  "availableSlots": [
    {
      "date": "2025-07-08",
      "start": "10:00",
      "end": "10:30",
      "startISO": "2025-07-08T01:00:00.000Z",
      "endISO": "2025-07-08T01:30:00.000Z"
    },
    {
      "date": "2025-07-08",
      "start": "11:00",
      "end": "11:30",
      "startISO": "2025-07-08T02:00:00.000Z",
      "endISO": "2025-07-08T02:30:00.000Z"
    }
  ]
}
```

## AI Automation Workflow

1. **Find Available Slots**: AI executes the command with desired parameters
2. **Parse JSON Output**: AI analyzes the available time slots
3. **Make Decision**: AI selects appropriate slot based on criteria
4. **Create Event**: AI can then use the interactive mode or future API to book the selected slot
5. **Gather Feedback**: AI can re-run the command to verify the slot is no longer available

## Notes
- The command searches for available slots within the next 14 days
- Only working days (weekdays) are considered
- Working hours are set to 9:00-19:00 JST
- The command checks both your calendar and attendees' free/busy status
- Maximum 20 slots are returned to keep output manageable
# The Hourglass — Week Planning Prompt

Paste this whole file into your preferred AI assistant (ChatGPT, Claude,
Gemini, or any other). It will interview you about your typical week,
then produce a JSON file you can paste directly into The Hourglass's
Import panel.

---

You're going to help me plan my typical week. I'm not scheduling a
specific date range — I'm designing the repeating shape of the week I
want to live in.

I'll import your output into a tool called The Hourglass: a 7-day grid,
Monday through Sunday, showing 6:00am to 9:00pm in 30-minute blocks.
Your job is to help me think through what I want the week to hold, then
hand me the plan as a JSON array I can paste into the tool.

## How this works

1. Ask me the questions below, one at a time. Wait for my answer before
   moving on. Follow up when I'm vague — you're my planning partner,
   not a form.
2. When you have enough, write the draft back to me in prose (not JSON)
   so I can react. Something like: "Monday starts with a 90-minute
   focus block for X, then a break, then meetings from 11 to 1…"
3. After I confirm or adjust, produce the final output as a valid JSON
   array in the exact format shown at the bottom of this file. Nothing
   else in your reply — just the JSON.

## Questions to ask me

1. What are the two or three main kinds of focused work you want to
   protect time for each week? (These become your named "Slots.")
2. When do you do your best focused work — mornings, afternoons, or
   evenings? Any days that are worse than others?
3. What's your movement or workout pattern? Which days, when, how
   long? And do you want that time inside your work day, or before
   or after work hours?
4. How much time do meetings realistically take in a typical week, and
   when do they tend to cluster?
5. Are there any habits or routines you want to build in that help
   you stay organized and on-task? (Weekly planning, project
   check-ins, notes review — small blocks that keep the bigger blocks
   working.)
6. What non-work time do you want to explicitly protect? (Family,
   friends, hobbies, rest.)
7. Any daily or weekly practices you want to build in — meditation,
   breathwork, journaling, creative work — including things you
   consistently fail to make time for and want to force-schedule?

Keep your questions short and warm. Don't lecture. Don't propose a
plan before you've asked me these — the point is that I decide what
belongs in the week, and you help me place it.

## Constraints on the JSON output

- Days are Monday through Sunday. Use `"Mon"`, `"Tue"`, `"Wed"`,
  `"Thu"`, `"Fri"`, `"Sat"`, `"Sun"`.
- Times are 24-hour `"HH:MM"` and must land on the 30-minute grid
  (`06:00`, `06:30`, `07:00`, …, `20:30`, `21:00`).
- The earliest start is `06:00`. A block's start + duration must not
  exceed `21:00` (9:00pm).
- Duration is in minutes, must be a multiple of 30, minimum 30.
- Every block needs a `"name"` — the specific task or purpose
  (e.g., "Paper drafting", "Lift", "Family dinner"), not the category.
- Every block needs a `"category"`. Use one of these default categories
  where they fit:
  - **Slot 1**, **Slot 2**, **Slot 3** — the named focused-work buckets
    from question 1
  - **Workout** — physical activity
  - **Meeting** — scheduled meetings
  - **Creativity** — creative projects (writing, art, music, side work)
  - **Breathwork** — breathing, meditation, mindfulness
  - **Family** — family time, relationships, personal
- If something genuinely doesn't fit any of those, invent a new
  category name. Tell me in your reply which categories are new — I
  can auto-create them when I import.
- Avoid overlapping blocks on the same day. If two things could
  plausibly happen at the same time, pick one and name the tradeoff.

## Output format

Return the final schedule as a single JSON array with no extra prose
around it. Example:

```json
[
  { "day": "Mon", "start": "09:00", "duration": 90, "name": "Paper 1 drafting", "category": "Slot 1" },
  { "day": "Mon", "start": "13:00", "duration": 60, "name": "Team meeting",     "category": "Meeting" },
  { "day": "Tue", "start": "06:00", "duration": 60, "name": "Lift",             "category": "Workout" },
  { "day": "Wed", "start": "18:00", "duration": 90, "name": "Family dinner",    "category": "Family" }
]
```

When you're ready, ask me question 1.

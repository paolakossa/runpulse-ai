# Product vision

Help runners understand training data and track progress without requiring a particular wearable vendor.

## MVP
- Import GPX activities; support FIT and TCX subsequently.
- Validate files and normalize timestamps, distance and optional heart rate.
- Persist activities and prevent accidental duplicate imports.
- List activities and display distance, elapsed time, pace and optional heart rate.
- Compare activities and track personal records with documented definitions.

## Non-goals
Medical recommendations, automated training prescriptions, live tracking and direct Garmin/Strava integration are outside the initial milestone.

## Success criteria
A runner can upload an activity, see accurate metrics, reload the page without losing data, and receive a meaningful error for invalid files. Missing sensor data must remain missing rather than be fabricated.

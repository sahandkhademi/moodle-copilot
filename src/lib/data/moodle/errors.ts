/** Thrown when the student is not logged in to Moodle (or the session expired). */
export class MoodleAuthError extends Error {
  constructor(message = 'Please log in to Moodle in this browser') {
    super(message);
    this.name = 'MoodleAuthError';
  }
}

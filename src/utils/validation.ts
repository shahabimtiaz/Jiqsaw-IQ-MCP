// ============================================================
// Input validation helpers
// ============================================================

/**
 * Validate a date string is in YYYY-MM-DD format and represents a real date.
 * Returns the validated date string or throws a descriptive error.
 */
export function validateDate(value: string, fieldName: string): string {
    const trimmed = value.trim();

    // Check format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new Error(
            `Invalid ${fieldName}: "${value}". Expected format: YYYY-MM-DD (e.g. 2025-02-15)`
        );
    }

    // Check it parses to a real date
    const parsed = new Date(trimmed + "T00:00:00Z");
    if (isNaN(parsed.getTime())) {
        throw new Error(
            `Invalid ${fieldName}: "${value}" is not a valid calendar date.`
        );
    }

    // Sanity check: not in the far future (more than 1 day ahead)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 2);
    if (parsed > tomorrow) {
        throw new Error(
            `Invalid ${fieldName}: "${value}" is in the future. Please use a past or current date.`
        );
    }

    return trimmed;
}

/**
 * Validate a date range (start <= end).
 */
export function validateDateRange(
    startDate: string,
    endDate: string
): { start: string; end: string } {
    const start = validateDate(startDate, "start_date");
    const end = validateDate(endDate, "end_date");

    if (new Date(start) > new Date(end)) {
        throw new Error(
            `Invalid date range: start_date (${start}) is after end_date (${end}).`
        );
    }

    return { start, end };
}

/**
 * Validate a numeric ID string (Shopify order IDs, customer IDs, etc.).
 */
export function validateNumericId(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
        throw new Error(
            `Invalid ${fieldName}: "${value}". Expected a numeric ID (e.g. "5123456789").`
        );
    }
    return trimmed;
}

/**
 * Validate a positive integer (for limits, counts, etc.).
 */
export function validatePositiveInt(
    value: number,
    fieldName: string,
    max: number = 250
): number {
    const int = Math.floor(value);
    if (int < 1) {
        throw new Error(`Invalid ${fieldName}: must be at least 1.`);
    }
    if (int > max) {
        throw new Error(`Invalid ${fieldName}: maximum is ${max}.`);
    }
    return int;
}

/**
 * Validate a generic string ID (Klaviyo IDs, etc.) – non-empty, reasonable length.
 */
export function validateStringId(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new Error(`Invalid ${fieldName}: cannot be empty.`);
    }
    if (trimmed.length > 200) {
        throw new Error(`Invalid ${fieldName}: too long (max 200 characters).`);
    }
    return trimmed;
}

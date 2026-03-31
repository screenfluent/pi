/**
 * Event Bus for pi-lens
 * 
 * Decoupled pub/sub system for diagnostic events.
 * Enables loose coupling between diagnostic producers (runners, LSP clients)
 * and consumers (UI, aggregators, history trackers).
 */

import type { z } from "zod";

// --- Types ---

export interface BusEvent<T = unknown> {
	type: string;
	properties: T;
	timestamp: number;
}

export type EventHandler<T> = (event: BusEvent<T>) => void | Promise<void>;

// --- Internal State ---

const subscribers = new Map<string, Set<EventHandler<unknown>>>();
const globalMiddleware: Array<(event: BusEvent) => BusEvent | undefined> = [];

let eventCount = 0;
let isDebugEnabled = false;

// --- Core Functions ---

function debug(type: string, event: BusEvent) {
	if (!isDebugEnabled) return;
	const timestamp = new Date(event.timestamp).toISOString();
	console.error(`[bus] [${timestamp}] ${type}: ${event.type}`);
}

/**
 * Publish an event to all subscribers
 */
export function publish<T>(event: BusEvent<T>): void {
	eventCount++;
	debug("publish", event as BusEvent<unknown>);

	// Run through middleware
	let currentEvent: BusEvent | undefined = event as BusEvent;
	for (const mw of globalMiddleware) {
		currentEvent = mw(currentEvent);
		if (!currentEvent) return; // Middleware cancelled the event
	}

	const handlers = subscribers.get(event.type);
	if (!handlers || handlers.size === 0) return;

	// Notify all subscribers (fire-and-forget for async handlers)
	for (const handler of handlers) {
		try {
			const result = handler(currentEvent as BusEvent<unknown>);
			if (result instanceof Promise) {
				result.catch((err) => {
					console.error(`[bus] async handler error for ${event.type}:`, err);
				});
			}
		} catch (err) {
			console.error(`[bus] handler error for ${event.type}:`, err);
		}
	}
}

/**
 * Subscribe to a specific event type
 * @returns Unsubscribe function
 */
export function subscribe<T>(
	eventType: string,
	handler: EventHandler<T>,
): () => void {
	if (!subscribers.has(eventType)) {
		subscribers.set(eventType, new Set());
	}

	const handlers = subscribers.get(eventType)!;
	handlers.add(handler as EventHandler<unknown>);

	debug("subscribe", { type: eventType, properties: {}, timestamp: Date.now() });

	// Return unsubscribe function
	return () => {
		handlers.delete(handler as EventHandler<unknown>);
		if (handlers.size === 0) {
			subscribers.delete(eventType);
		}
	};
}

/**
 * Subscribe to an event type and automatically unsubscribe after first match
 */
export function once<T>(
	eventType: string,
	predicate?: (event: BusEvent<T>) => boolean,
): Promise<BusEvent<T>> {
	return new Promise((resolve) => {
		const unsubscribe = subscribe<T>(eventType, (event) => {
			if (!predicate || predicate(event)) {
				unsubscribe();
				resolve(event);
			}
		});
	});
}

/**
 * Wait for an event with timeout
 */
export function waitFor<T>(
	eventType: string,
	timeoutMs: number,
	predicate?: (event: BusEvent<T>) => boolean,
): Promise<BusEvent<T> | undefined> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			unsubscribe();
			resolve(undefined);
		}, timeoutMs);

		const unsubscribe = subscribe<T>(eventType, (event) => {
			if (!predicate || predicate(event)) {
				clearTimeout(timer);
				unsubscribe();
				resolve(event);
			}
		});
	});
}

// --- Middleware ---

export function addMiddleware(
	mw: (event: BusEvent) => BusEvent | undefined,
): () => void {
	globalMiddleware.push(mw);
	return () => {
		const idx = globalMiddleware.indexOf(mw);
		if (idx !== -1) globalMiddleware.splice(idx, 1);
	};
}

// --- Utilities ---

export function enableDebug(enabled = true): void {
	isDebugEnabled = enabled;
}

export function getStats(): {
	subscriberCount: number;
	eventTypes: string[];
	totalEvents: number;
} {
	return {
		subscriberCount: Array.from(subscribers.values()).reduce(
			(sum, set) => sum + set.size,
			0,
		),
		eventTypes: Array.from(subscribers.keys()),
		totalEvents: eventCount,
	};
}

export function clearAllSubscribers(): void {
	subscribers.clear();
}

// --- Event Factory ---

export interface EventDefinition<T> {
	type: string;
	create(properties: T): BusEvent<T>;
	subscribe(handler: EventHandler<T>): () => void;
	publish(properties: T): void;
}

export namespace BusEvent {
	/**
	 * Define a typed event type with Zod schema validation
	 */
	export function define<T>(
		type: string,
		_schema: z.ZodType<T>,
	): EventDefinition<T> {
		return {
			type,
			create(properties): BusEvent<T> {
				return {
					type,
					properties,
					timestamp: Date.now(),
				};
			},
			subscribe(handler: EventHandler<T>): () => void {
				return subscribe(type, handler);
			},
			publish(properties: T): void {
				publish({
					type,
					properties,
					timestamp: Date.now(),
				});
			},
		};
	}

	/**
	 * Create a simple event type without schema (for internal use)
	 */
	export function defineSimple<T>(type: string): EventDefinition<T> {
		return {
			type,
			create(properties: T): BusEvent<T> {
				return {
					type,
					properties,
					timestamp: Date.now(),
				};
			},
			subscribe(handler: EventHandler<T>): () => void {
				return subscribe(type, handler);
			},
			publish(properties: T): void {
				publish({
					type,
					properties,
					timestamp: Date.now(),
				});
			},
		};
	}

	/**
	 * Create a raw event (helper)
	 */
	export function create<T>(type: string, properties: T): BusEvent<T> {
		return {
			type,
			properties,
			timestamp: Date.now(),
		};
	}
}

// --- Re-export for convenience ---
export { subscribe as on, publish as emit };

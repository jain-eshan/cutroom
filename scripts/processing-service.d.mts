export declare const SERVICE_PORT: number;

export type ServiceState = "starting" | "running" | "exited" | "external";

export type ServiceStatus = {
	state: ServiceState;
	log: string[];
	ranBefore: boolean;
};

export declare function createProcessingService(cwd: string): {
	start(): Promise<void>;
	stop(): void;
	status(): ServiceStatus;
};

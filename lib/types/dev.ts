export type TurnStatus = "answered" | "no-answer" | "error";

export type RetrievedChunk = {
	content: string;
	similarity: number;
};

export type DevTurn = {
	id: string;
	timestamp: Date;
	domain: string;
	status: TurnStatus;
	latency: {
		total: number;
		queryGen: number;
		retrieval: number;
		llm: number;
	};
	model: string;
	tokens: {
		input: number;
		output: number;
	};
	estimatedCost: number;
	retrieval: {
		topK: number;
		chunksReturned: number;
		generatedQueries: string[];
		chunks: RetrievedChunk[];
	};
	prompt: {
		system: string;
		userMessage: string;
	};
	response: string;
};

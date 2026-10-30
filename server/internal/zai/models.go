package zai

type Image struct {
	MediaType string
	Data      []byte
}

type Request struct {
	Model           string
	System          string
	Text            string
	Images          []Image
	MaxTokens       int
	ReasoningEffort string
}

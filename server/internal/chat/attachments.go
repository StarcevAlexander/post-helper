package chat

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/anthropics/anthropic-sdk-go"
)

func buildAttachmentBlocks(attachments []Attachment) ([]anthropic.ContentBlockParamUnion, error) {
	blocks := make([]anthropic.ContentBlockParamUnion, 0, len(attachments))
	for _, attachment := range attachments {
		block, err := buildAttachmentBlock(attachment)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", attachment.Name, err)
		}
		blocks = append(blocks, block)
	}
	return blocks, nil
}

func buildAttachmentBlock(attachment Attachment) (anthropic.ContentBlockParamUnion, error) {
	if len(attachment.Data) == 0 {
		return anthropic.ContentBlockParamUnion{}, ErrUnsupportedAttachment
	}

	sniffed := http.DetectContentType(attachment.Data[:min(len(attachment.Data), SniffLength)])
	mediaType, _, _ := strings.Cut(sniffed, ";")

	if _, isImage := imageMediaTypes[mediaType]; isImage {
		return anthropic.NewImageBlockBase64(mediaType, base64.StdEncoding.EncodeToString(attachment.Data)), nil
	}
	if mediaType == pdfMediaType {
		source := anthropic.Base64PDFSourceParam{Data: base64.StdEncoding.EncodeToString(attachment.Data)}
		return anthropic.NewDocumentBlock(source), nil
	}
	if strings.HasPrefix(mediaType, "text/") && utf8.Valid(attachment.Data) {
		text := fmt.Sprintf(TextAttachmentFmt, attachment.Name, attachment.Data)
		return anthropic.NewTextBlock(text), nil
	}
	return anthropic.ContentBlockParamUnion{}, ErrUnsupportedAttachment
}

package audit

import "testing"

func TestNormalizeHandle(t *testing.T) {
	tests := []struct {
		input string
		want  string
		ok    bool
	}{
		{"anna_nails", "anna_nails", true},
		{"@Anna_Nails", "anna_nails", true},
		{"  anna.nails  ", "anna.nails", true},
		{"instagram.com/anna_nails", "anna_nails", true},
		{"https://instagram.com/anna_nails", "anna_nails", true},
		{"https://www.instagram.com/anna_nails/", "anna_nails", true},
		{"https://www.instagram.com/anna_nails/?hl=ru&igsh=abc", "anna_nails", true},
		{"http://instagr.am/anna_nails", "anna_nails", true},
		{"https://INSTAGRAM.com/Anna_Nails", "anna_nails", true},
		{"", "", false},
		{"   ", "", false},
		{"@", "", false},
		{"анна_ногти", "", false},
		{"anna nails", "", false},
		{"anna-nails", "", false},
		{"a..b", "", false},
		{".anna", "", false},
		{"anna.", "", false},
		{"https://instagram.com/p/Cxyz123/", "", false},
		{"https://instagram.com/reel/Cxyz123/", "", false},
		{"https://instagram.com/anna_nails/followers", "", false},
		{"https://instagram.com/", "", false},
		{"https://facebook.com/anna_nails", "", false},
		{"https://evil.example/instagram.com/anna", "", false},
		{"p", "", false},
		{"explore", "", false},
		{"javascript:alert(1)", "", false},
		{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, ok := NormalizeHandle(tt.input)
			if ok != tt.ok || got != tt.want {
				t.Errorf("NormalizeHandle(%q) = %q, %v; want %q, %v", tt.input, got, ok, tt.want, tt.ok)
			}
		})
	}
}

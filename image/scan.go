package image

import (
	"fmt"
	"image/color"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// ValidExts 是支持的图片扩展名集合（外加 webp 已包含）
var ValidExts = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".bmp":  true,
	".gif":  true,
	".webp": true,
}

// ParseHexColor 解析十六进制颜色：支持 #RRGGBB、RRGGBB、#RGB、RGB。
func ParseHexColor(s string) (color.RGBA, error) {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "#")
	switch len(s) {
	case 3:
		s = string([]byte{s[0], s[0], s[1], s[1], s[2], s[2]})
	case 6:
	default:
		return color.RGBA{}, fmt.Errorf("颜色格式应为 #RRGGBB 或 #RGB，实际为 %q", s)
	}
	n, err := strconv.ParseUint(s, 16, 32)
	if err != nil {
		return color.RGBA{}, fmt.Errorf("颜色格式应为 #RRGGBB 或 #RGB，实际为 %q", s)
	}
	return color.RGBA{
		R: uint8(n >> 16),
		G: uint8(n >> 8),
		B: uint8(n),
		A: 255,
	}, nil
}

// ScanDir 读取目录下支持格式的图片（不递归），按文件名排序。
func ScanDir(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取目录失败：%w", err)
	}
	var paths []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !isSupportedExt(name) {
			continue
		}
		paths = append(paths, filepath.Join(dir, name))
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("目录中没有支持的图片：%s", dir)
	}
	sort.Strings(paths)
	return paths, nil
}

package image

import (
	"fmt"
	stdimg "image"
	_ "image/gif"  // 注册 GIF 解码器
	_ "image/jpeg" // 注册 JPEG 解码器
	_ "image/png"  // 注册 PNG 解码器
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "golang.org/x/image/bmp"  // 注册 BMP 解码器
	_ "golang.org/x/image/webp" // 注册 WebP 解码器（仅解码，无编码）
)

// decodeImage 打开并解码任意支持格式的图片
func decodeImage(path string) (stdimg.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("无法打开文件：%w", err)
	}
	defer f.Close()

	img, _, err := stdimg.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("解码失败（可能文件已损坏或格式不支持）：%w", err)
	}
	return img, nil
}

// isSupportedExt 判断文件扩展名是否受支持（供其他文件复用校验逻辑）
func isSupportedExt(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ValidExts[ext]
}

// filterReadable 去掉打不开或解码失败的路径，避免拼图按原数量排版后留下空格。
func filterReadable(paths []string) []string {
	if len(paths) == 0 {
		return paths
	}
	ok := make([]bool, len(paths))
	workers := 8
	if len(paths) < workers {
		workers = len(paths)
	}
	var wg sync.WaitGroup
	jobCh := make(chan int)
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobCh {
				img, err := decodeImage(paths[i])
				if err != nil {
					fmt.Printf("跳过无法解码的图片：%s\n", filepath.Base(paths[i]))
					continue
				}
				_ = img
				ok[i] = true
			}
		}()
	}
	for i := range paths {
		jobCh <- i
	}
	close(jobCh)
	wg.Wait()

	out := make([]string, 0, len(paths))
	for i, p := range paths {
		if ok[i] {
			out = append(out, p)
		}
	}
	if skipped := len(paths) - len(out); skipped > 0 {
		fmt.Printf("已跳过 %d 张无法解码的图片\n", skipped)
	}
	return out
}

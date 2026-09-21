package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	connectTimeout = 20 * time.Second
	copyTimeout    = 10 * time.Minute
)

type config struct {
	listen   string
	username string
	password string
	prefix   net.IP
	poolSize uint64
}

type proxyServer struct {
	cfg  config
	next atomic.Uint64
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatal(err)
	}
	server := &proxyServer{cfg: cfg}
	listener, err := net.Listen("tcp", cfg.listen)
	if err != nil {
		log.Fatal(err)
	}
	defer listener.Close()
	log.Printf("ipv6 dynamic proxy listening on %s with pool size %d", cfg.listen, cfg.poolSize)
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("accept failed: %v", err)
			continue
		}
		go server.handle(conn)
	}
}

func loadConfig() (config, error) {
	listen := getenv("LISTEN", "0.0.0.0:19080")
	username := strings.TrimSpace(os.Getenv("PROXY_USERNAME"))
	password := os.Getenv("PROXY_PASSWORD")
	prefixText := strings.TrimSpace(getenv("IPV6_PREFIX", "2a03:4000:47:a0c::/64"))
	poolSizeText := getenv("POOL_SIZE", "10000")
	if username == "" || password == "" {
		return config{}, errors.New("PROXY_USERNAME and PROXY_PASSWORD are required")
	}
	ip, network, err := net.ParseCIDR(prefixText)
	if err != nil || network == nil || network.IP.To4() != nil || prefixLen(network) != 64 {
		return config{}, errors.New("IPV6_PREFIX must be an IPv6 /64")
	}
	poolSize, err := strconv.ParseUint(poolSizeText, 10, 64)
	if err != nil || poolSize == 0 || poolSize > 100000 {
		return config{}, errors.New("POOL_SIZE must be between 1 and 100000")
	}
	return config{listen: listen, username: username, password: password, prefix: ip.Mask(network.Mask), poolSize: poolSize}, nil
}

func prefixLen(network *net.IPNet) int {
	ones, bits := network.Mask.Size()
	if bits != 128 {
		return -1
	}
	return ones
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func (s *proxyServer) handle(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(connectTimeout))
	reader := bufio.NewReader(conn)
	first, err := reader.Peek(1)
	if err != nil {
		return
	}
	if first[0] == 0x05 {
		s.handleSOCKS5(conn, reader)
		return
	}
	s.handleHTTPConnect(conn, reader)
}

func (s *proxyServer) handleSOCKS5(conn net.Conn, reader *bufio.Reader) {
	header := make([]byte, 2)
	if _, err := io.ReadFull(reader, header); err != nil || header[0] != 0x05 {
		return
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(reader, methods); err != nil {
		return
	}
	if !contains(methods, 0x02) {
		_, _ = conn.Write([]byte{0x05, 0xff})
		return
	}
	if _, err := conn.Write([]byte{0x05, 0x02}); err != nil {
		return
	}
	authHeader := make([]byte, 2)
	if _, err := io.ReadFull(reader, authHeader); err != nil || authHeader[0] != 0x01 {
		return
	}
	user := make([]byte, int(authHeader[1]))
	if _, err := io.ReadFull(reader, user); err != nil {
		return
	}
	passLen := []byte{0}
	if _, err := io.ReadFull(reader, passLen); err != nil {
		return
	}
	pass := make([]byte, int(passLen[0]))
	if _, err := io.ReadFull(reader, pass); err != nil {
		return
	}
	if !s.auth(string(user), string(pass)) {
		_, _ = conn.Write([]byte{0x01, 0x01})
		return
	}
	if _, err := conn.Write([]byte{0x01, 0x00}); err != nil {
		return
	}
	request := make([]byte, 4)
	if _, err := io.ReadFull(reader, request); err != nil || request[0] != 0x05 || request[1] != 0x01 {
		return
	}
	target, err := readSOCKSAddress(reader, request[3])
	if err != nil {
		socksReply(conn, 0x08)
		return
	}
	upstream, err := s.dial(target)
	if err != nil {
		socksReply(conn, 0x04)
		return
	}
	defer upstream.Close()
	if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	bridge(conn, upstream)
}

func (s *proxyServer) handleHTTPConnect(conn net.Conn, reader *bufio.Reader) {
	request, err := httpRequest(reader)
	if err != nil || !strings.EqualFold(request.method, "CONNECT") {
		_, _ = io.WriteString(conn, "HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n")
		return
	}
	if !s.authBasic(request.headers["proxy-authorization"]) {
		_, _ = io.WriteString(conn, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"ipv6-pool\"\r\nConnection: close\r\n\r\n")
		return
	}
	upstream, err := s.dial(request.target)
	if err != nil {
		_, _ = io.WriteString(conn, "HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n")
		return
	}
	defer upstream.Close()
	if _, err := io.WriteString(conn, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	bridge(conn, upstream)
}

func (s *proxyServer) dial(target string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return nil, err
	}
	addresses, err := resolveIPv6(host)
	if err != nil {
		return nil, err
	}
	index := s.next.Add(1) - 1
	for offset := uint64(0); offset < uint64(len(addresses)); offset++ {
		local := &net.TCPAddr{IP: s.sourceIP(index + offset), Port: 0}
		dialer := net.Dialer{Timeout: connectTimeout, LocalAddr: local, KeepAlive: 30 * time.Second}
		conn, err := dialer.DialContext(context.Background(), "tcp6", net.JoinHostPort(addresses[(index+offset)%uint64(len(addresses))].String(), port))
		if err == nil {
			_ = conn.SetDeadline(time.Now().Add(copyTimeout))
			return conn, nil
		}
	}
	return nil, errors.New("all IPv6 upstream connections failed")
}

func (s *proxyServer) sourceIP(index uint64) net.IP {
	ip := append(net.IP(nil), s.cfg.prefix.To16()...)
	value := (index % s.cfg.poolSize) + 0x1000
	for i := 0; i < 8; i++ {
		ip[15-i] = byte(value >> (8 * i))
	}
	return ip
}

func resolveIPv6(host string) ([]net.IP, error) {
	if ip := net.ParseIP(host); ip != nil {
		if ip.To4() != nil {
			return nil, errors.New("IPv4 upstream is not supported")
		}
		return []net.IP{ip}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return net.DefaultResolver.LookupIP(ctx, "ip6", host)
}

func (s *proxyServer) auth(user, password string) bool {
	return subtle.ConstantTimeCompare([]byte(user), []byte(s.cfg.username)) == 1 && subtle.ConstantTimeCompare([]byte(password), []byte(s.cfg.password)) == 1
}

func (s *proxyServer) authBasic(value string) bool {
	prefix := "Basic "
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(strings.TrimPrefix(value, prefix)))
	if err != nil {
		return false
	}
	parts := strings.SplitN(string(decoded), ":", 2)
	return len(parts) == 2 && s.auth(parts[0], parts[1])
}

type httpRequestData struct {
	method  string
	target  string
	headers map[string]string
}

func httpRequest(reader *bufio.Reader) (httpRequestData, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return httpRequestData{}, err
	}
	parts := strings.Fields(line)
	if len(parts) < 2 {
		return httpRequestData{}, errors.New("invalid HTTP request")
	}
	data := httpRequestData{method: parts[0], target: parts[1], headers: map[string]string{}}
	for {
		line, err = reader.ReadString('\n')
		if err != nil {
			return httpRequestData{}, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			return data, nil
		}
		key, value, ok := strings.Cut(line, ":")
		if ok {
			data.headers[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
		}
	}
}

func readSOCKSAddress(reader *bufio.Reader, atyp byte) (string, error) {
	switch atyp {
	case 0x01:
		buf := make([]byte, 4)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return "", err
		}
		port, err := readPort(reader)
		return net.JoinHostPort(net.IP(buf).String(), strconv.Itoa(port)), err
	case 0x03:
		length, err := reader.ReadByte()
		if err != nil || length == 0 {
			return "", errors.New("invalid domain")
		}
		host := make([]byte, int(length))
		if _, err := io.ReadFull(reader, host); err != nil {
			return "", err
		}
		port, err := readPort(reader)
		return net.JoinHostPort(string(host), strconv.Itoa(port)), err
	case 0x04:
		buf := make([]byte, 16)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return "", err
		}
		port, err := readPort(reader)
		return net.JoinHostPort(net.IP(buf).String(), strconv.Itoa(port)), err
	default:
		return "", errors.New("unsupported address type")
	}
}

func readPort(reader *bufio.Reader) (int, error) {
	buf := make([]byte, 2)
	if _, err := io.ReadFull(reader, buf); err != nil {
		return 0, err
	}
	return int(buf[0])<<8 | int(buf[1]), nil
}

func socksReply(conn net.Conn, code byte) {
	_, _ = conn.Write([]byte{0x05, code, 0, 0x01, 0, 0, 0, 0, 0, 0})
}

func bridge(left, right net.Conn) {
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(right, left); done <- struct{}{} }()
	go func() { _, _ = io.Copy(left, right); done <- struct{}{} }()
	<-done
}

func contains(values []byte, want byte) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

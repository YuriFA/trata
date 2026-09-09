# syntax=docker/dockerfile:1
#
# CGO-free build: Postgres needs no cgo, so the image drops gcc/musl entirely
# and builds a static binary with CGO_ENABLED=0.
#
# Cross-build at native speed: the builder stage runs on the BUILD
# platform (e.g. an arm64 laptop) and Go cross-compiles for the target
# (--platform linux/amd64 from the deploy pipeline). Only the final
# runtime stage is pulled for the target platform.

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS builder

# Build version reported by GET /api/health: the deployed image tag
# (sha-<short>) from the deploy pipeline, or `dev` for local builds.
ARG VERSION=dev
# Target OS/arch, filled by BuildKit from --platform (linux/amd64).
ARG TARGETOS TARGETARCH

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w -X main.version=$VERSION" -o /out/trata-api ./cmd/trata-api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /out/trata-api /app/trata-api
COPY config/prod.yaml /app/prod.yaml
EXPOSE 8080
ENV ENV=prod
ENV TZ=UTC
ENV CONFIG_PATH=/app/prod.yaml
ENV DATABASE_URL=postgres://expense:expense@localhost:5432/expense?sslmode=disable
ENTRYPOINT [ "/app/trata-api" ]

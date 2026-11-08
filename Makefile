install:
	pnpm install --frozen-lockfile

dev:
	pnpm dev

verify:
	pnpm test
	pnpm check
	pnpm build

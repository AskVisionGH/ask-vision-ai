/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your sign-in link for Vision</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandRow}>
          <Text style={brand}>
            Vision<span style={brandItalic}>.</span>
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>
            Your <span style={italic}>sign-in</span> link
          </Heading>
          <Text style={text}>
            Tap the button below to sign in to {siteName}. This link expires
            shortly, so use it soon.
          </Text>
          <Section style={buttonWrap}>
            <Button style={button} href={confirmationUrl}>
              Sign in to Vision
            </Button>
          </Section>
          <Text style={muted}>
            If you didn't request this link, you can safely ignore this email.
          </Text>
        </Section>
        <Text style={footer}>
          Vision — your AI agent for Solana.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  margin: 0,
  padding: '40px 0',
}
const container = { maxWidth: '520px', margin: '0 auto', padding: '0 24px' }
const brandRow = { padding: '0 0 24px' }
const brand = {
  fontSize: '20px',
  fontWeight: 600 as const,
  color: '#09090b',
  letterSpacing: '-0.01em',
  margin: 0,
}
const brandItalic = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: 'italic' as const,
  color: '#8b5cf6',
}
const card = {
  border: '1px solid #ececf0',
  borderRadius: '14px',
  padding: '32px 28px',
  background: '#ffffff',
}
const h1 = {
  fontSize: '24px',
  fontWeight: 600 as const,
  color: '#09090b',
  letterSpacing: '-0.02em',
  margin: '0 0 16px',
  lineHeight: '1.2',
}
const italic = {
  fontFamily: "'Instrument Serif', Georgia, serif",
  fontStyle: 'italic' as const,
  fontWeight: 400 as const,
  color: '#8b5cf6',
}
const text = { fontSize: '15px', color: '#52525b', lineHeight: '1.6', margin: '0 0 24px' }
const buttonWrap = { padding: '4px 0 24px' }
const button = {
  backgroundColor: '#8b5cf6',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: 600 as const,
  borderRadius: '12px',
  padding: '12px 22px',
  textDecoration: 'none',
  display: 'inline-block',
}
const muted = { fontSize: '13px', color: '#a1a1aa', lineHeight: '1.5', margin: 0 }
const footer = {
  fontSize: '12px',
  color: '#a1a1aa',
  textAlign: 'center' as const,
  margin: '24px 0 0',
}

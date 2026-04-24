/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your new email for Vision</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={brandRow}>
          <Text style={brand}>
            Vision<span style={brandItalic}>.</span>
          </Text>
        </Section>
        <Section style={card}>
          <Heading style={h1}>
            Confirm your <span style={italic}>new email</span>
          </Heading>
          <Text style={text}>
            You asked to change the email on your {siteName} account from{' '}
            <Link href={`mailto:${email}`} style={link}>
              {email}
            </Link>{' '}
            to{' '}
            <Link href={`mailto:${newEmail}`} style={link}>
              {newEmail}
            </Link>
            . Confirm the change with the button below.
          </Text>
          <Section style={buttonWrap}>
            <Button style={button} href={confirmationUrl}>
              Confirm email change
            </Button>
          </Section>
          <Text style={muted}>
            If you didn't request this, please secure your account immediately.
          </Text>
        </Section>
        <Text style={footer}>
          Vision — your AI agent for Solana.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail

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
const link = { color: '#8b5cf6', textDecoration: 'none', fontWeight: 500 as const }
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

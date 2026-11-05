// CLE-238 — Office add-in manifest for the ClearHR panel in Word.
//
// Public (no data). Word only loads add-ins over https, so the URLs
// point at this deployment when it's served over https (production or a
// Vercel preview) and at the live app otherwise (e.g. a local http dev
// server). Sideload it in Word (Insert → Add-ins → Upload My Add-in) or
// deploy it org-wide from Microsoft 365 admin centre → Integrated apps.

import { appBaseUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

const ADDIN_ID = "965591b4-c353-4e4e-8511-eca0bc345739";
const VERSION = "1.0.0.0";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const base = esc((origin.startsWith("https://") ? origin : appBaseUrl()).replace(/\/+$/, ""));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
  xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
  xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>${VERSION}</Version>
  <ProviderName>ClearHR</ProviderName>
  <DefaultLocale>en-GB</DefaultLocale>
  <DisplayName DefaultValue="ClearHR"/>
  <Description DefaultValue="Insert ClearHR merge fields into document templates, check them, and send them to ClearHR."/>
  <IconUrl DefaultValue="${base}/word-addin/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${base}/word-addin/icon-64.png"/>
  <SupportUrl DefaultValue="${base}/"/>
  <AppDomains>
    <AppDomain>${base}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.3">
      <Set Name="WordApi" MinVersion="1.3"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${base}/word-addin"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="ClearHR.Group">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16"/>
                  <bt:Image size="32" resid="Icon.32"/>
                  <bt:Image size="80" resid="Icon.80"/>
                </Icon>
                <Control xsi:type="Button" id="ClearHR.TaskpaneButton">
                  <Label resid="Button.Label"/>
                  <Supertip>
                    <Title resid="Button.Label"/>
                    <Description resid="Button.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16"/>
                    <bt:Image size="32" resid="Icon.32"/>
                    <bt:Image size="80" resid="Icon.80"/>
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>ClearHR.Taskpane</TaskpaneId>
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16" DefaultValue="${base}/word-addin/icon-16.png"/>
        <bt:Image id="Icon.32" DefaultValue="${base}/word-addin/icon-32.png"/>
        <bt:Image id="Icon.80" DefaultValue="${base}/word-addin/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="${base}/"/>
        <bt:Url id="Taskpane.Url" DefaultValue="${base}/word-addin"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="ClearHR merge fields"/>
        <bt:String id="Group.Label" DefaultValue="ClearHR"/>
        <bt:String id="Button.Label" DefaultValue="ClearHR fields"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Open ClearHR fields on the Home tab to insert merge fields and send this template to ClearHR."/>
        <bt:String id="Button.Tooltip" DefaultValue="Insert ClearHR merge fields, check the template and send it to ClearHR."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'attachment; filename="clearhr-word-manifest.xml"',
      "Cache-Control": "no-store",
    },
  });
}

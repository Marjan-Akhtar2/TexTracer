# TexTracer Vision

Build a professional, clean, interactive frontend prototype for a web application called “TexTracer”, using the attached TexTracer Software Requirements Specification (SRS) as the SINGLE SOURCE OF TRUTH for the system requirements, roles, workflows, terminology, screens, and functionality.

I am also providing the TexTracer logo. Use the provided logo exactly as the primary branding/logo of the application.

IMPORTANT DEVELOPMENT RULES

This is a frontend-only prototype.

Do NOT create or require a real backend.

Do NOT require MySQL, FastAPI, blockchain, RFID hardware, ESP32, IPFS, smart contracts, APIs, authentication servers, or any external database.

Use realistic demo/mock data in the frontend to demonstrate all required functionality.

All interactions should work entirely in the browser.

The project must run easily on another person's laptop after downloading/opening the project.

Do not require special hardware.

Do not require environment variables or API keys.

Do not add unnecessary dependencies or complicated setup.

Keep the application self-contained and easy to run.

If persistence is needed for the prototype, use browser/local mock state only.

The purpose is to demonstrate the complete UI/UX and system workflow, not the actual backend implementation.

The prototype should look and behave like a professional enterprise textile manufacturing tracking system.

1. BRANDING AND FIRST-OPEN EXPERIENCE

When the website is opened, do NOT immediately show the dashboard.

Create the following opening sequence:

Screen 1 — TexTracer Logo Splash Screen

When the website opens:

Show the provided TexTracer logo prominently in the center.

Show the name:

TexTracer

Add a small professional subtitle:

Real-Time Textile Manufacturing Tracking & Verification

Use a clean, professional enterprise-style layout.

Keep the splash screen minimal.

Use a subtle smooth fade/transition.

After a short moment, automatically transition to the login screen.

Do NOT add unnecessary animations, illustrations, marketing text, or extra buttons.

2. LOGIN SCREEN

After the splash screen, show the TexTracer login page.

The login page should be clean and extremely easy to understand.

Include:

TexTracer logo

TexTracer name

Email/Username field

Password field

Login button

Role selection/login demonstration mechanism appropriate for a prototype

Since there is no real backend, create demo login accounts for each required role.

The six roles defined in the SRS are:

System Administrator

Department Officer

Warehouse Manager

QC Officer

Auditor

Senior Management

For the prototype, the user should be able to select a demo role or use clearly documented demo credentials.

After login, redirect the user to the dashboard/interface appropriate to that role.

Do NOT create registration, forgot-password systems, social login, Google login, or other authentication features because they are not required by the SRS.

3. ROLE-BASED ACCESS

Implement a realistic frontend simulation of Role-Based Access Control.

Each role should see only the features relevant to that role.

System Administrator

Can:

View/manage users

Create demo users

Assign roles

Update role assignments

View role permissions

The SRS specifies that the System Administrator manages user accounts and role assignment.

Department Officer

Can:

View their department

View items arriving at their department

Scan item IN

Perform departmental processing simulation

Scan item OUT

Submit item to the next stage/gate

The prototype should simulate RFID scanning using a button/modal such as:

“Simulate RFID Scan”

When clicked, show realistic scan information such as:

Product ID

RFID UID

Reader ID

Current stage

Timestamp

Scan status

Do NOT require an actual RFID reader.

Warehouse Manager

Responsible for:

Gate 1 — Raw Material Intake

Can:

View incoming raw material

View purchase order information

Review received material

Approve

Reject

Enter rejection reason when rejecting

See blockchain verification/demo status

The approval/rejection interaction should actually work in the prototype.

For example:

Click Approve → item status changes to:

Approved — Blockchain Anchored

Click Reject → require a rejection reason → item status changes to:

Rejected

and show:

Procurement notified for return/replacement

This is a frontend simulation only.

4. QC OFFICER

Responsible for:

Gate 2 — Stitching / QC

The QC Officer dashboard must allow:

View items awaiting QC

View production/QC information

Inspect an item

Approve

Reject

Enter rejection reason

Mark item for rework

Send failed item back to Production

See blockchain verification/demo status

Important workflow:

If QC rejects an item:

QC Failed → Rework Required → Production

The item must then return to the QC gate again after rework.

The UI should visually demonstrate this workflow.

After the item passes QC:

QC Approved → Stitching

This workflow is explicitly required by the SRS.

5. AUDITOR

The Auditor must have a strictly read-only interface.

Do NOT provide operational approval, rejection, scanning, editing, or deletion actions.

The Auditor should be able to:

Search products

View complete product history

View approval history

View rejection history

View rework history

View timestamps

View current stage

View blockchain verification status

View event details

Create a professional Audit History interface.

Each event can show:

Event ID

Product ID

Event type

Stage

User/Role

Timestamp

Status

Blockchain status

Transaction/CID placeholder

Use realistic demo blockchain values.

Clearly label demo blockchain information as simulated/demo data where appropriate.

6. SENIOR MANAGEMENT DASHBOARD

Senior Management has a read-only dashboard.

Do NOT provide operational actions.

The dashboard must focus on the KPIs specified in the SRS:

Items currently in progress

Department throughput

Rejection rate

Average cycle time

Bottleneck detection

Stalled-item alerts

Aggregated rejection reasons

Blockchain verification status

The dashboard should be visually professional and easy to understand.

Use:

KPI cards

Clean charts

Department throughput visualization

Rejection reason visualization

Cycle-time information

Stalled-item alerts

Production flow overview

Blockchain verification summary

Do not overload the dashboard with unnecessary charts.

Every visualization must have a clear purpose based on the SRS.

7. PRODUCTION FLOW

The main manufacturing process must be represented exactly in this order:

Raw Material 1 → Raw Material 2 → Design → Manufacturing 1 → Manufacturing 2 → Production → Stitching → Packaging → Shipping

This order must be visible in the relevant interfaces.

Create a clean visual Production Tracking / Product Journey component showing:

Raw Material 1

Raw Material 2

Design

Manufacturing 1

Manufacturing 2

Production

Stitching

Packaging

Shipping

Show the current stage clearly.

Completed stages should visually appear completed.

The current stage should be highlighted.

Future stages should appear pending.

Do not change or reorder these stages.

8. THREE BLOCKCHAIN GATES

Clearly represent the three blockchain-related gates from the SRS.

Gate 1

Raw Material Intake

Warehouse Manager:

Approve / Reject

Gate 2

Stitching / QC

QC Officer:

Approve / Reject / Rework

Gate 3

Before Shipment

Show:

Production Complete → Ready for Shipment

The prototype should visually demonstrate that these events are blockchain-anchored.

Since this is frontend-only, use realistic simulated blockchain verification information.

For example:

Verified

Pending

Rejected

Block/Transaction ID

CID

Timestamp

Do NOT claim that an actual blockchain is connected.

The exact blockchain platform is intentionally undecided in the SRS, so do not select or implement a specific blockchain platform.

9. PRODUCT TRACKING

Create a Product Tracking / Product Details interface.

A user should be able to search/select a demo Product ID such as:

TX-1001

Show:

Product Information

Product ID

RFID UID

Current stage

Current location

Status

Created/received time

Manufacturing Journey

Show the complete stage-by-stage history.

For each stage show:

Stage

Timestamp

Status

Reader ID

Responsible role

Event information

Verification

Show:

Identity verification

Stage verification

History verification

Shipment information

Blockchain verification status

The SRS specifically requires authorized users to verify product identity, stage history, timestamps, shipment information, and anchored CIDs.

10. RFID SCAN SIMULATION

Because this is a frontend-only prototype, simulate RFID functionality.

Create a simple interaction:

Scan RFID

When clicked, show a modal/card containing:

RFID UID

Reader ID

Detected Product

Detected Stage

Timestamp

Validation result

Example:

RFID UID:
RFID-7A92F31C

Reader:
READER-MFG-01

Product:
TX-1001

Stage:
Manufacturing 1

Status:
Valid Scan

Add a clear visual success state.

Also demonstrate an invalid/out-of-sequence scan.

For example:

Invalid Scan

“Expected next stage: Production”

“Received stage: Packaging”

Show that the scan is rejected and is not recorded.

This directly represents the sequence-validation requirement in the SRS.

11. EXCEPTION HANDLING

The prototype must visibly demonstrate the exception scenarios defined in the SRS.

Scenario 1 — Warehouse Rejection

Show:

Rejected

Reason required

Procurement notified for return/replacement.

Scenario 2 — QC Failure

Show:

QC Failed

↓
Rework Required

↓
Production

↓
QC Again

↓
Approved

Scenario 3 — Stalled Item

Show a management alert such as:

Stalled Item

Product: TX-1007

Current Stage: Manufacturing 2

Expected Next Stage: Production

Status:

No scan detected within expected time window

Scenario 4 — Out-of-Sequence Scan

Show:

Scan Rejected

Expected:
Production

Received:
Packaging

Reason:
Out-of-sequence scan

The SRS requires out-of-sequence scans to be rejected and not recorded.

12. DEMO DATA

Use realistic but clearly fictional demo data.

Create enough demo data to make the application feel alive.

Example products:

TX-1001

TX-1002

TX-1003

TX-1004

TX-1005

TX-1006

TX-1007

Use different statuses:

In Progress

Approved

Rejected

Rework Required

Ready for Shipment

Shipped

Stalled

Create realistic timestamps, RFID UIDs, reader IDs, departments, users, rejection reasons, and blockchain verification statuses.

The demo data should allow every important screen and workflow to be demonstrated.

13. NAVIGATION

Use a clean professional sidebar/navigation system.

Navigation should change according to the logged-in role.

Do NOT show every possible feature to every user.

For example:

Management

Dashboard

Product Tracking

Alerts

Blockchain Verification

Auditor

Audit History

Product Tracking

Blockchain Verification

Warehouse Manager

Dashboard

Raw Material Intake

Gate 1

Product Tracking

QC Officer

Dashboard

QC Inspection

Gate 2

Rework

Product Tracking

Department Officer

Department Dashboard

RFID Scan

Items

Product Tracking

System Administrator

Dashboard

Users

Roles & Permissions

Keep navigation minimal.

Do not add pages that are not required by the SRS.

14. UI/UX DESIGN

The website must look like a professional enterprise manufacturing management system, not a student-looking website.

Design requirements:

Clean

Modern

Professional

Minimal

Highly readable

Intuitive

Consistent

Responsive

Desktop-first but usable on smaller screens

Proper spacing

Clear typography

Clear buttons

Clear status indicators

Professional tables

Professional cards

Professional charts

Use the provided TexTracer logo as the main branding element.

Use a restrained professional color palette that works well with the logo.

Do not use excessive gradients, glowing effects, excessive animations, cartoon illustrations, or decorative elements.

15. STATUS COLORS

Use consistent visual status indicators.

For example:

Green = Approved / Completed / Verified

Red = Rejected / Failed

Orange/Yellow = Pending / Warning / Stalled

Blue = In Progress / Information

Gray = Not Started

Keep colors accessible and professional.

16. INTERACTIVITY

The prototype must NOT be a collection of static screens.

Make the important interactions actually work.

Examples:

Login → appropriate role dashboard

Sidebar navigation works

Search works

Product selection works

Product details update

RFID Scan button opens scan simulation

Approve button changes item status

Reject button opens rejection reason

QC rejection sends item to rework

Rework sends item back toward QC

QC approval moves item forward

Alerts can be opened

Tables can be filtered

Product history can be viewed

Blockchain verification modal/details can be opened

User role management works with demo state

Logout returns to login

Back/navigation works correctly

Modals open and close properly

Buttons should never be decorative/non-functional if they appear actionable

17. PRODUCT JOURNEY VISUALIZATION

Create a polished product journey component.

Example:

Raw Material 1
✓ Completed

↓

Raw Material 2
✓ Completed

↓

Design
✓ Completed

↓

Manufacturing 1
✓ Completed

↓

Manufacturing 2
● Current

↓

Production
○ Pending

↓

Stitching
○ Pending

↓

Packaging
○ Pending

↓

Shipping
○ Pending

This should update based on the selected demo product.

18. DASHBOARD DESIGN

Do not put everything on one screen.

Use clear sections.

A typical dashboard may contain:

Top

TexTracer branding + page title + user role + notification + logout

KPI section

Relevant KPIs for that role.

Main content

Production tracking / pending approvals / QC / department information depending on role.

Secondary section

Alerts, recent activity, or verification information.

Keep information hierarchy very clear.

The user should understand the page within seconds.

19. RESPONSIVE DESIGN

The website should work properly on:

Laptop

Desktop

Smaller laptop screens

Avoid layouts that overflow horizontally.

Tables should remain usable.

Sidebar should adapt appropriately.

Do not build a mobile-only application; the primary target is a laptop/desktop browser.

20. IMPORTANT: DO NOT ADD THESE FEATURES

Do NOT add:

E-commerce

Payment system

Chat system

Social media

Messaging

AI chatbot

Customer reviews

Notifications unrelated to the SRS

Inventory management features not specified

Employee attendance

Payroll

Marketing pages

Shopping cart

Supplier marketplace

Retail marketplace

Unnecessary analytics

Unnecessary settings

Unnecessary profile customization

Real blockchain integration

Real RFID integration

Real backend

Real database

Real API

Real authentication server

Do not invent functionality.

If something is not required by the SRS, leave it out unless it is strictly necessary for usability.

21. DEMO MODE

Since this is a prototype, make it obvious internally that the data is demo/simulated data without making the UI look unfinished.

For example, a subtle label:

Prototype Demo Mode

Do not repeatedly display warnings.

The goal is to demonstrate what the final TexTracer system would look and feel like.

22. ERROR AND EMPTY STATES

Create professional empty/error states where needed.

Examples:

“No products found.”

“No pending approvals.”

“No audit events found.”

“Invalid RFID scan.”

“Out-of-sequence scan rejected.”

“Please provide a rejection reason.”

These should be clear and user-friendly.

23. ACCESS CONTROL BEHAVIOR

Make role restrictions visually obvious.

Auditor and Senior Management must remain read-only.

Do not show Approve, Reject, Scan, Edit, or other operational buttons on their interfaces.

This is important because the SRS explicitly requires Auditor and Senior Management views to be strictly read-only.

24. FINAL QUALITY REQUIREMENT

Before finishing, test the entire frontend prototype as if you are a real user.

Verify:

Website opens correctly.

TexTracer splash screen appears first.

Splash transitions to login.

Login works using demo roles.

Each role gets the correct interface.

Navigation works.

Product tracking works.

RFID simulation works.

Warehouse Gate 1 approval/rejection works.

QC Gate 2 approval/rejection/rework works.

Shipment Gate 3 is represented.

Product journey updates correctly.

Audit history is read-only.

Management dashboard is read-only.

Stalled-item alerts are visible.

Out-of-sequence scan behavior is demonstrated.

Blockchain verification information is displayed as simulated data.

Logout works.

No page has broken buttons or dead links.

No unnecessary functionality has been added.

MOST IMPORTANT INSTRUCTION

Follow the attached TexTracer SRS exactly.

The SRS is the source of truth.

Do not redesign the system architecture.

Do not invent requirements.

Do not add unnecessary features.

Do not remove required workflows.

Build a professional, polished, highly interactive frontend prototype that demonstrates the TexTracer system clearly to a teacher, evaluator, industry representative, or end user.

The final result should feel like a real enterprise textile manufacturing tracking application while remaining completely frontend-only and runnable without a backend.

Use the attached TexTracer SRS for all system requirements and the attached TexTracer logo for branding.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://tracer-flow-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4dccaddf-8b11-4677-93c7-5f3175fd3c3f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

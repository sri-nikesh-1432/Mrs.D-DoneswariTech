import re

# Fix LandingPage.tsx - remove duplicate createCampaign call
with open('frontend/src/pages/LandingPage.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# The bug: handleStartCampaign calls createCampaign again instead of startCampaign
old = 'const handleStartCampaign = async () => {\n    if (!campaignId || !canStart) return;\n    setIsStarting(true);\n    try {\n      await createCampaign({\n        campaign_name: campaignName,\n        institute_name: instituteName,\n      });\n      navigate(\"/dashboard\");'
new = 'const handleStartCampaign = async () => {\n    if (!campaignId || !canStart) return;\n    setIsStarting(true);\n    try {\n      const { startCampaign } = await import(\"../services/api\");\n      await startCampaign(campaignId);\n      navigate(\"/dashboard\");'

if old in content:
    content = content.replace(old, new)
    with open('frontend/src/pages/LandingPage.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed LandingPage.tsx - removed duplicate createCampaign")
else:
    print("Could not find the exact old string in LandingPage.tsx")
    # Try to find what's actually there
    idx = content.find('handleStartCampaign')
    if idx > 0:
        print(content[idx:idx+500])

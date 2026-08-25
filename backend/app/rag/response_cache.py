"""
Smart Response Cache — Skip the LLM for common questions.

For the most frequently asked questions about admissions, fees, courses,
and contact info, we can serve cached responses instantly. This eliminates
LLM latency entirely (200-3000ms saved) and guarantees <500ms TTFA.

The cache is keyword-based and fuzzy-matched, so slight variations of the
same question (\"fee entha\", \"fees\", \"what are the fees\") all hit cache.
"""

import re

import asyncio
import base64
from typing import Optional, Tuple

# Pre-synthesized audio cache: maps (response_hash, language) -> base64 audio
# Populated at startup so the first cached response hit has ZERO TTS latency.
_tts_cache: dict[str, str] = {}
_tts_cache_ready = False

async def warm_tts_cache(tts_service) -> None:
    """Pre-synthesize all cached responses at startup for instant audio."""
    global _tts_cache_ready
    if _tts_cache_ready:
        return
    try:
        for _, responses in _CACHE_ENTRIES:
            for lang, text in responses.items():
                key = f"{hash(text)}_{lang}"
                if key not in _tts_cache:
                    try:
                        audio = await tts_service.synthesize(text, language=lang)
                        if audio:
                            _tts_cache[key] = base64.b64encode(audio).decode("utf-8")
                    except Exception:
                        pass  # TTS warmup failure is non-fatal
        _tts_cache_ready = True
        import logging
        logging.getLogger(__name__).info("TTS cache warmed: %d entries", len(_tts_cache))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("TTS cache warmup failed: %s", e)


def get_cached_audio(text: str, language: str) -> Optional[str]:
    """Get pre-synthesized audio for a cached response. Returns None if not warmed yet."""
    key = f"{hash(text)}_{language}"
    return _tts_cache.get(key)




# ── Cache entries ──────────────────────────────────────────────────────────
# Each entry: (compiled_regex, {language: response_text})
# The regex matches the INTENT of the question, not exact words.

_CACHE_ENTRIES: list[Tuple[re.Pattern, dict[str, str]]] = [
    # ── GREETING ──
    (
        re.compile(r"^(hi|hello|hey|namaste|vanakkam|namaskar|namaskaram)$", re.I),
        {
            "Telugu": "నమస్కారం! నేను మిసెస్ డీ, నారాయణ జూనియర్ కాలేజీ అడ్మిషన్ కౌన్సెలర్. మీకు కోర్సులు, ఫీజులు, హాస్టల్ లేదా అడ్మిషన్ గురించి ఏదైనా సమాచారం కావాలా?",
            "English": "Hello! I'm Mrs.D, admissions counsellor at Narayana Junior College. How can I help you today — would you like to know about our courses, fees, or admission process?",
            "Hindi": "नमस्ते! मैं मिसेज डी हूं, नारायणा जूनियर कॉलेज में एडमिशन काउंसलर। आज मैं आपकी कैसे मदद कर सकती हूं — क्या आप कोर्स, फीस या एडमिशन प्रोसेस के बारे में जानना चाहते हैं?",
        },
    ),
    # ── FEES ──
    (
        re.compile(r"(fee|fees|ఫీజు|ఖర్చు|cost|price|ధర|how.much|ఎంత|entha|ఖరీదు)", re.I),
        {
            "Telugu": "నారాయణలో ఫీజు కోర్సు మీద ఆధారపడి ఉంటుంది. MPC, BiPC, MEC, CEC స్ట్రీమ్స్ అందుబాటులో ఉన్నాయి. మీకు ఏ కోర్సు గురించి తెలుసుకోవాలి?",
            "English": "Fees at Narayana vary by course. We offer MPC, BiPC, MEC and CEC streams with different fee structures. Which course are you interested in — I can share the exact fees?",
            "Hindi": "नारायणा में फीस कोर्स के हिसाब से अलग-अलग है। MPC, BiPC, MEC और CEC स्ट्रीम्स उपलब्ध हैं। आप किस कोर्स के बारे में जानना चाहते हैं?",
        },
    ),
    # ── COURSES ──
    (
        re.compile(r"(course|courses|కోర్సు|streams|branches|స్ట్రీమ్|MPC|BiPC|MEC|CEC|ఏ కోర్సు|ఏముంది|ఏమేమి|what.do.you.offer)", re.I),
        {
            "Telugu": "నారాయణలో MPC, BiPC, MEC, CEC స్ట్రీమ్స్ ఉన్నాయి. MPC ఇంజనీరింగ్ కి, BiPC మెడిసిన్ కి గ్రేట్. మీ బిడ్డకు ఏ స్ట్రీమ్ సరిపోతుంది?",
            "English": "We offer MPC for engineering aspirants, BiPC for medical, MEC for commerce, and CEC for humanities. Each stream has expert faculty and dedicated results. Which stream interests you?",
            "Hindi": "हमारे पास इंजीनियरिंग के लिए MPC, मेडिकल के लिए BiPC, कॉमर्स के लिए MEC और ह्यूमैनिटीज के लिए CEC है। आपको कौन सा स्ट्रीम चाहिए?",
        },
    ),
    # ── ADMISSION ──
    (
        re.compile(r"(admission|అడ్మిషన్|join|చేరడం|apply|అప్లై|enroll|registration|రిజిస్టర్|how.to.join|ఎలా చేరాలి)", re.I),
        {
            "Telugu": "అడ్మిషన్ చాలా సింపుల్! SSC మార్కులతో మా క్యాంపస్ విజిట్ చేయండి లేదా మమ్మల్ని కాల్ చేయండి. సీట్లు లిమిటెడ్ గా ఉంటాయి కాబట్టి త్వరగా రండి.",
            "English": "Admission is simple! Visit our campus with your SSC marks or give us a call. Seats fill up fast, so I'd recommend applying early. Would you like to know about the admission process?",
            "Hindi": "एडमिशन बहुत आसान है! अपने SSC मार्क्स लेकर हमारे कैंपस में आएं या कॉल करें। सीटें जल्दी भर जाती हैं, इसलिए जल्दी अप्लाई करें।",
        },
    ),
    # ── HOSTEL ──
    (
        re.compile(r"(hostel|హాస్టల్|accommodation|staying|వసతి|లోపల ఉండగలరా|డార్మిటరీ)", re.I),
        {
            "Telugu": "అవును, నారాయణలో హాస్టల్ సౌకర్యం ఉంది. బాయ్స్ మరియు గర్ల్స్ హాస్టల్స్ వేర్వేరుగా ఉంటాయి. భోజనం, స్టడీ రూమ్, Wi-Fi అన్నీ అందుబాటులో ఉన్నాయి.",
            "English": "Yes, we have hostel facilities for both boys and girls. The hostels include meals, study rooms, Wi-Fi and 24/7 security. Would you like to know the hostel fees?",
            "Hindi": "हां, हमारे पास लड़कों और लड़कियों दोनों के लिए हॉस्टल है। भोजन, स्टडी रूम, Wi-Fi और 24/7 सिक्योरिटी उपलब्ध है।",
        },
    ),
    # ── RESULTS / RANKINGS ──
    (
        re.compile(r"(result|results|ఫలితాలు|rank|ranking|toppers|iit|neet|టాపర్లు|performance|ప్రదర్శన)", re.I),
        {
            "Telugu": "నారాయణ స్టూడెంట్స్ ప్రతి సంవత్సరం IIT, NEET, EAMCET లో టాప్ ర్యాంకులు సాధిస్తున్నారు. మా ఫ్యాకల్టీ చాలా ఎక్స్పీరియన్స్డ్, స్టూడెంట్స్ కి ఇండివిజువల్ అటెన్షన్ ఇస్తారు.",
            "English": "Narayana students consistently achieve top ranks in IIT JEE, NEET, and EAMCET every year. Our experienced faculty provides individual attention to help each student succeed.",
            "Hindi": "नारायणा के छात्र हर साल IIT JEE, NEET और EAMCET में टॉप रैंक हासिल करते हैं। हमारे अनुभवी फैकल्टी हर छात्र को व्यक्तिगत ध्यान देते हैं।",
        },
    ),
    # ── TRANSPORT ──
    (
        re.compile(r"(transport|bus|బస్సు|commut|travell|రవాణా|వెళ్లడం|ఎలా రావాలి)", re.I),
        {
            "Telugu": "నారాయణ క్యాంపస్ హైదరాబాద్ లో బాగా కనెక్ట్ అయి ఉంది. బస్ సర్వీస్ కూడా అందుబాటులో ఉంది. మీ ఏరియా నుండి ఎలా రావాలో చెప్తాను.",
            "English": "Our campus is well-connected across Hyderabad. Bus transport service is available from major areas. Which part of the city are you located in?",
            "Hindi": "हमारा कैंपस हैदराबाद में अच्छी तरह से कनेक्टेड है। बस सेवा प्रमुख क्षेत्रों से उपलब्ध है।",
        },
    ),
    # ── LOCATION / ADDRESS ──
    (
        re.compile(r"(location|address|where|ఎక్కడ|ఎక్కడ ఉంది|ఎక్కడ ఉన్నారు|campus|క్యాంపస్|direction|map|జూబిలీ|jubilee|ameerpet|మియాపూర్)", re.I),
        {
            "Telugu": "నారాయణ జూబిలీ హిల్స్, అమీర్‌పేట్ మరియు హైదరాబాద్ లోని ఇతర లొకేషన్లలో క్యాంపస్ లు ఉన్నాయి. మీకు దగ్గరలో ఏది కావాలి?",
            "English": "We have campuses in Jubilee Hills, Ameerpet, and other locations across Hyderabad. Which area would be most convenient for you?",
            "Hindi": "हमारे कैंपस जुबली हिल्स, अमीरपेट और हैदराबाद के अन्य स्थानों पर हैं। आपके लिए कौन सा सबसे सुविधाजनक है?",
        },
    ),
    # ── SCHOLARSHIP ──
    (
        re.compile(r"(scholarship|స్కాలర్షిప్|fee.waiver|concession|డిస్కౌంట్|free|ఉచిత)", re.I),
        {
            "Telugu": "అవును, నారాయణలో మెరిట్ బేస్డ్ స్కాలర్షిప్స్ ఉన్నాయి. SSC మార్కుల ఆధారంగా ఫీజులో డిస్కౌంట్ పొందవచ్చు. మీ మార్కులు ఎన్ని?",
            "English": "Yes, we offer merit-based scholarships! Students with strong SSC marks can get fee concessions. What were your marks — I can check eligibility?",
            "Hindi": "हां, हम मेरिट-आधारित स्कॉलरशिप देते हैं! अच्छे SSC मार्क्स वाले छात्रों को फीस में छूट मिल सकती है। आपके कितने मार्क्स हैं?",
        },
    ),
    # ── ADMISSION DATES ──
    (
        re.compile(r"(last.date|deadline|due.date|apply.by|closing|చివరి తేదీ|ఎప్పటిలోగా|when.does)", re.I),
        {
            "Telugu": "అడ్మిషన్స్ ఓపెన్ గా ఉన్నాయి. SSC మార్కులతో ఎప్పుడైనా రావచ్చు. సీట్లు ఫిల్ అవడానికి ముందు రావడం మంచిది. ఈరోజే విజిట్ చేయండి.",
            "English": "Admissions are currently open! You can apply anytime with your SSC marks. I'd recommend visiting soon as seats fill up quickly. Would you like to schedule a campus visit?",
            "Hindi": "एडमिशन अभी खुले हैं! आप SSC मार्क्स के साथ कभी भी अप्लाई कर सकते हैं। सीटें जल्दी भर जाती हैं, इसलिए जल्दी आएं।",
        },
    ),
    # ── SPORTS ──
    (
        re.compile(r"(sport|sports|స్పోర్ట్స్|game|games|cricket|football|ఫుట్\s*బాల్|క్రికెట్|ఆట|play|gym|ఫిట్నెస్|ఎక్సర్సైజ్)", re.I),
        {
            "Telugu": "నారాయణలో క్రికెట్, ఫుట్ బాల్, బాస్కెట్ బాల్, వాలీబాల్, బ్యాడ్మింటన్ వంటి స్పోర్ట్స్ ఉన్నాయి. ప్రతి స్పోర్ట్స్ కోసం కోచ్ ఉంటారు. మీ బిడ్డకు ఏ స్పోర్ట్స్ ఇష్టం?",
            "English": "We have cricket, football, basketball, volleyball, badminton and more. Each sport has dedicated coaches. Our students regularly participate in inter-school competitions. Which sport does your child enjoy?",
            "Hindi": "हमारे पास क्रिकेट, फुटबॉल, बास्केटबॉल, वॉलीबॉल, बैडमिंटन जैसे खेल हैं। हर खेल के लिए कोच हैं।",
        },
    ),
    # ── LAB / INFRASTRUCTURE ──
    (
        re.compile(r"(lab|labs|laborator|ప్రయోగశాల|సౌకర్యాలు|facilit|infrastructure|ఇన్ఫ్రా|భవనం|building|equipment|పరికరాలు)", re.I),
        {
            "Telugu": "నారాయణలో ఆధునిక సైన్స్ ల్యాబ్స్, కంప్యూటర్ ల్యాబ్స్, లైబ్రరీ, మరియు స్మార్ట్ క్లాస్ రూమ్స్ ఉన్నాయి. ప్రతి ల్యాబ్ లో అవసరమైన అన్ని పరికరాలు ఉంటాయి. మీరు క్యాంపస్ విజిట్ చేసి చూడండి.",
            "English": "We have modern science labs, computer labs, a well-stocked library, and smart classrooms. Each lab is fully equipped with all necessary instruments. I'd invite you for a campus visit to see the facilities firsthand.",
            "Hindi": "हमारे पास आधुनिक साइंस लैब्स, कंप्यूटर लैब्स, लाइब्रेरी और स्मार्ट क्लासरूम हैं। हर लैब में सभी जरूरी उपकरण हैं।",
        },
    ),
    # ── JEE / NEET batches ──
    (
        re.compile(r"(jee|neet|iit|ఎంసెట్|eamcet|ప్రత్యేక|special|batch|బ్యాచ్|coaching|కోచింగ్|preparation|ప్రిపరేషన్)", re.I),
        {
            "Telugu": "అవును, నారాయణలో JEE, NEET మరియు EAMCET కోసం ప్రత్యేక బ్యాచ్ లు ఉన్నాయి. స్టూడెంట్స్ కి ఇండివిజువల్ అటెన్షన్, టెస్ట్ సిరీస్, మరియు ఎక్స్పర్ట్ ఫ్యాకల్టీ ఉంటారు.",
            "English": "Yes, we have dedicated batches for JEE, NEET and EAMCET with specialized faculty, regular mock tests, and individual attention for each student. Which entrance exam is your child preparing for?",
            "Hindi": "हां, JEE, NEET और EAMCET के लिए अलग-अलग बैच हैं। विशेषज्ञ फैकल्टी, मॉक टेस्ट और व्यक्तिगत ध्यान दिया जाता है।",
        },
    ),
    # ── CONTACT / PHONE ──
    (
        re.compile(r"(phone|number|contact|కాల్|ఫోన్|నంబర్|reach|సంప్రదించ|call.you)", re.I),
        {
            "Telugu": "మమ్మల్ని కాల్ చేయండి లేదా మా క్యాంపస్ కి విజిట్ చేయండి. మీకు ఏ సమాచారం కావాలో చెప్పండి, నేను హెల్ప్ చేస్తాను.",
            "English": "You can reach us by phone or visit our campus. What specific information would you like — I'm happy to help!",
            "Hindi": "आप हमें फोन कर सकते हैं या कैंपस आ सकते हैं। आपको क्या जानकारी चाहिए?",
        },
    ),
]


def find_cached_response(user_input: str, language: str = "English") -> Optional[str]:
    """
    Try to find a cached response for the user's input.
    
    Returns the cached text if a match is found, None otherwise.
    The match is case-insensitive and regex-based, so natural variations
    of the same question all hit the cache.
    """
    if not user_input or not user_input.strip():
        return None
    
    text = user_input.strip()
    
    # Normalize: remove common prefixes/fillers
    text = re.sub(r"^(hmm|umm|uh|ah|oh|సరే|okay|ok|please|చెప్పండి|tell.me|can.you|i.want.to.know.about|naku|naaku)\s*[,.]?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*[,.]?\s*(andi|అండి|ప్లీజ్|please|చెప్పండి)$", "", text, flags=re.I)
    
    if not text:
        return None
    
    for pattern, responses in _CACHE_ENTRIES:
        if pattern.search(text):
            # Get the response in the requested language, fallback to English
            resp = responses.get(language) or responses.get("English")
            if resp:
                return resp
    
    return None


def cache_stats() -> dict:
    """Return cache statistics for logging."""
    return {
        "entries": len(_CACHE_ENTRIES),
        "patterns": [p.pattern[:50] for p, _ in _CACHE_ENTRIES],
    }

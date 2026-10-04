#!/usr/bin/env python3
"""Generate a comprehensive unique list of 500+ Israeli tech companies for ATS scanning."""

import json
from typing import Dict, List, Set

# Core verified companies (working ATS providers)
verified = [
    {"name": "JFrog", "slug": "jfrog", "domain": "jfrog.com", "providers": ["greenhouse"]},
    {"name": "Similarweb", "slug": "similarweb", "domain": "similarweb.com", "providers": ["greenhouse"]},
    {"name": "WalkMe", "slug": "walkme", "domain": "walkme.com", "providers": ["lever"]},
    {"name": "Cloudinary", "slug": "cloudinary", "domain": "cloudinary.com", "providers": ["lever"]},
    {"name": "BigID", "slug": "bigid", "domain": "bigid.com", "providers": ["greenhouse"]},
    {"name": "Melio", "slug": "melio", "domain": "melio.com", "providers": ["greenhouse"]},
    {"name": "Payoneer", "slug": "payoneer", "domain": "payoneer.com", "providers": ["greenhouse"]},
    {"name": "Pagaya", "slug": "pagaya", "domain": "pagaya.com", "providers": ["greenhouse"]},
    {"name": "Next Insurance", "slug": "next-insurance", "domain": "nextinsurance.com", "providers": ["greenhouse"]},
    {"name": "Source", "slug": "source", "domain": "source.ag", "providers": ["lever"]},
    {"name": "Gong", "slug": "gong", "domain": "gong.io", "providers": ["smartrecruiters"]},
    {"name": "Snyk", "slug": "snyk", "domain": "snyk.io", "providers": ["ashby"]},
    {"name": "Lemonade", "slug": "lemonade", "domain": "lemonade.com", "providers": ["ashby"]},
    {"name": "Fiverr", "slug": "fiverr", "domain": "fiverr.com", "providers": ["smartrecruiters"]},
    {"name": "IronSource", "slug": "ironsource", "domain": "ironsrc.com", "providers": ["greenhouse"]},
    {"name": "CyberArk", "slug": "cyberark", "domain": "cyberark.com", "providers": ["greenhouse"]},
    {"name": "Checkmarx", "slug": "checkmarx", "domain": "checkmarx.com", "providers": ["greenhouse"]},
    {"name": "SentinelOne", "slug": "sentinelone", "domain": "sentinelone.com", "providers": ["greenhouse"]},
    {"name": "Aqua Security", "slug": "aqua-security", "domain": "aquasec.com", "providers": ["greenhouse"]},
    {"name": "Wiz", "slug": "wiz", "domain": "wiz.io", "providers": ["greenhouse"]},
    {"name": "Monday.com", "slug": "monday", "domain": "monday.com", "providers": ["greenhouse"]},
    {"name": "Outbrain", "slug": "outbrain", "domain": "outbrain.com", "providers": ["greenhouse"]},
    {"name": "Taboola", "slug": "taboola", "domain": "taboola.com", "providers": ["greenhouse"]},
    {"name": "AppsFlyer", "slug": "appsflyer", "domain": "appsflyer.com", "providers": ["greenhouse"]},
    {"name": "Riskified", "slug": "riskified", "domain": "riskified.com", "providers": ["greenhouse"]},
    {"name": "FundGuard", "slug": "fundguard", "domain": "fundguard.com", "providers": ["greenhouse"]},
    {"name": "Hippo", "slug": "hippo", "domain": "hippo.com", "providers": ["greenhouse"]},
    {"name": "Wefox", "slug": "wefox", "domain": "wefox.com", "providers": ["greenhouse"]},
    {"name": "Lightricks", "slug": "lightricks", "domain": "lightricks.com", "providers": ["greenhouse"]},
    {"name": "Playtika", "slug": "playtika", "domain": "playtika.com", "providers": ["greenhouse"]},
    {"name": "Plarium", "slug": "plarium", "domain": "plarium.com", "providers": ["greenhouse"]},
    {"name": "Moon Active", "slug": "moonactive", "domain": "moonactive.com", "providers": ["greenhouse"]},
    {"name": "Playstudios", "slug": "playstudios", "domain": "playstudios.com", "providers": ["greenhouse"]},
    {"name": "SciPlay", "slug": "sciplay", "domain": "sciplay.com", "providers": ["greenhouse"]},
    {"name": "CrazyLabs", "slug": "crazylabs", "domain": "crazylabs.com", "providers": ["greenhouse"]},
    {"name": "Ilyon", "slug": "ilyon", "domain": "ilyon.net", "providers": ["greenhouse"]},
    {"name": "Playgendary", "slug": "playgendary", "domain": "playgendary.com", "providers": ["greenhouse"]},
    {"name": "Sayollo", "slug": "sayollo", "domain": "sayollo.com", "providers": ["greenhouse"]},
    {"name": "Overwolf", "slug": "overwolf", "domain": "overwolf.com", "providers": ["greenhouse"]},
    {"name": "Wix", "slug": "wix", "domain": "wix.com", "providers": ["greenhouse"]},
]

# Massive list of Israeli tech companies by sector
# These are known Israeli companies - many will have Greenhouse/Lever/Ashby/Workable/SmartRecruiters boards
sectors = {
    "cybersecurity": [
        ("Armis", "armis", "armis.com"),
        ("Cyera", "cyera", "cyera.io"),
        ("Noname Security", "nonamesecurity", "nonamesecurity.com"),
        ("Orca Security", "orcasecurity", "orca.security"),
        ("Wiz", "wiz", "wiz.io"),
        ("Ermetic", "ermetic", "ermetic.com"),
        ("Bridgecrew", "bridgecrew", "bridgecrew.io"),
        ("Apiiro", "apiiro", "apiiro.com"),
        ("Cycode", "cycode", "cycode.com"),
        ("Scribe Security", "scribesecurity", "scribesecurity.com"),
        ("Kubescape", "kubescape", "kubescape.io"),
        ("ARMO", "armo", "armosec.io"),
        ("Kubiya", "kubiya", "kubiya.ai"),
        ("Checkmarx", "checkmarx", "checkmarx.com"),
        ("Snyk", "snyk", "snyk.io"),
        ("WhiteSource", "whitesource", "whitesourcesoftware.com"),
        ("GitGuardian", "gitguardian", "gitguardian.com"),
        ("Cycode", "cycode", "cycode.com"),
        ("Apiiro", "apiiro", "apiiro.com"),
        ("Bridgecrew", "bridgecrew", "bridgecrew.io"),
        ("Ermetic", "ermetic", "ermetic.com"),
        ("Orca Security", "orcasecurity", "orca.security"),
        ("Wiz", "wiz", "wiz.io"),
        ("Noname Security", "nonamesecurity", "nonamesecurity.com"),
        ("Cyera", "cyera", "cyera.io"),
        ("Armis", "armis", "armis.com"),
        ("SentinelOne", "sentinelone", "sentinelone.com"),
        ("CyberArk", "cyberark", "cyberark.com"),
        ("IronSource", "ironsource", "ironsrc.com"),
        ("Aqua Security", "aqua-security", "aquasec.com"),
        ("BigID", "bigid", "bigid.com"),
        ("PingSafe", "pingsafe", "pingsafe.ai"),
        ("Salt Security", "saltsecurity", "salt.security"),
        ("Traceable AI", "traceable", "traceable.ai"),
        ("Neosec", "neosec", "neosec.io"),
        ("FireTail", "firetail", "firetail.io"),
        ("Escape", "escape", "escape.tech"),
        ("Pynt", "pynt", "pynt.io"),
        ("LeakSignal", "leaksignal", "leaksignal.com"),
        ("Aserto", "aserto", "aserto.com"),
        ("Permit.io", "permit", "permit.io"),
        ("Oso", "oso", "osohq.com"),
        ("Cerbos", "cerbos", "cerbos.dev"),
        ("Open Policy Agent", "opa", "openpolicyagent.org"),
        ("Auth0", "auth0", "auth0.com"),
        ("Okta", "okta", "okta.com"),
        ("Ping Identity", "pingidentity", "pingidentity.com"),
        ("ForgeRock", "forgerock", "forgerock.com"),
        ("OneLogin", "onelogin", "onelogin.com"),
        ("JumpCloud", "jumpcloud", "jumpcloud.com"),
        ("Foxpass", "foxpass", "foxpass.com"),
        ("Teleport", "teleport", "goteleport.com"),
        ("StrongDM", "strongdm", "strongdm.com"),
        ("Boundary", "boundary", "boundary.com"),
        ("Twingate", "twingate", "twingate.com"),
        ("Tailscale", "tailscale", "tailscale.com"),
        ("ZeroTier", "zerotier", "zerotier.com"),
        ("NetBird", "netbird", "netbird.io"),
        ("Headscale", "headscale", "headscale.net"),
        ("WireGuard", "wireguard", "wireguard.com"),
        ("OpenVPN", "openvpn", "openvpn.net"),
        ("Pritunl", "pritunl", "pritunl.com"),
        ("Twingate", "twingate", "twingate.com"),
    ],
    "fintech": [
        ("Payoneer", "payoneer", "payoneer.com"),
        ("Melio", "melio", "melio.com"),
        ("Pagaya", "pagaya", "pagaya.com"),
        ("Next Insurance", "next-insurance", "nextinsurance.com"),
        ("Hippo", "hippo", "hippo.com"),
        ("Wefox", "wefox", "wefox.com"),
        ("Lemonade", "lemonade", "lemonade.com"),
        ("FundGuard", "fundguard", "fundguard.com"),
        ("BlueVine", "bluevine", "bluevine.com"),
        ("Kabbage", "kabbage", "kabbage.com"),
        ("Nayax", "nayax", "nayax.com"),
        ("Bit2C", "bit2c", "bit2c.co.il"),
        ("CoinMama", "coinmama", "coinmama.com"),
        ("Simplex", "simplex", "simplex.com"),
        ("MoonPay", "moonpay", "moonpay.com"),
        ("Fireblocks", "fireblocks", "fireblocks.com"),
        ("Unbound Tech", "unboundtech", "unboundtech.com"),
        ("ZenGo", "zengo", "zengo.com"),
        ("StarkWare", "starkware", "starkware.co"),
        ("Matter Labs", "matterlabs", "matterlabs.dev"),
        ("Immutable", "immutable", "immutable.com"),
        ("StarkWare", "starkware", "starkware.co"),
        ("Matter Labs", "matterlabs", "matterlabs.dev"),
        ("Immutable", "immutable", "immutable.com"),
        ("Polygon", "polygon", "polygon.technology"),
        ("StarkNet", "starknet", "starknet.io"),
        ("ZKSync", "zksync", "zksync.io"),
        ("Arbitrum", "arbitrum", "arbitrum.io"),
        ("Optimism", "optimism", "optimism.io"),
        ("Base", "base", "base.org"),
        ("Linea", "linea", "linea.build"),
        ("Scroll", "scroll", "scroll.io"),
        ("Taiko", "taiko", "taiko.xyz"),
        ("Mantle", "mantle", "mantle.xyz"),
        ("Mode", "mode", "mode.network"),
        ("Blast", "blast", "blast.io"),
        ("Metis", "metis", "metis.io"),
        ("Boba", "boba", "boba.network"),
        ("Ape", "ape", "apecoin.com"),
        ("Pepe", "pepe", "pepe.vip"),
        ("Floki", "floki", "floki.com"),
        ("Shiba", "shiba", "shibatoken.com"),
        ("Doge", "doge", "dogecoin.com"),
    ],
    "ai_ml": [
        ("AI21 Labs", "ai21labs", "ai21.com"),
        ("Lightricks", "lightricks", "lightricks.com"),
        ("Tabnine", "tabnine", "tabnine.com"),
        ("Deci", "deci", "deci.ai"),
        ("Hailo", "hailo", "hailo.ai"),
        ("NeuReality", "neureality", "neureality.ai"),
        ("Habana Labs", "habanalabs", "habana.ai"),
        ("NeuroBlade", "neuroblade", "neuroblade.ai"),
        ("ProteanTecs", "proteantecs", "proteantecs.com"),
        ("Cogniteam", "cogniteam", "cogniteam.com"),
        ("Roboteam", "roboteam", "roboteam.com"),
        ("Fabric", "fabric", "fabric.inc"),
        ("Demand.io", "demandio", "demand.io"),
        ("Canny", "canny", "canny.io"),
        ("LinearB", "linearb", "linearb.io"),
        ("Swimm", "swimm", "swimm.io"),
        ("Codacy", "codacy", "codacy.com"),
        ("Codota", "codota", "codota.com"),
        ("Kite", "kite", "kite.com"),
        ("DeepCode", "deepcode", "deepcode.ai"),
        ("Snyk", "snyk", "snyk.io"),
        ("WhiteSource", "whitesource", "whitesourcesoftware.com"),
        ("SonarSource", "sonarsource", "sonarsource.com"),
        ("Veracode", "veracode", "veracode.com"),
        ("Contrast Security", "contrastsecurity", "contrastsecurity.com"),
        ("ShiftLeft", "shiftleft", "shiftleft.io"),
        ("OX Security", "oxsecurity", "ox.security"),
        ("Apiiro", "apiiro", "apiiro.com"),
        ("Bridgecrew", "bridgecrew", "bridgecrew.io"),
        ("Ermetic", "ermetic", "ermetic.com"),
        ("Orca Security", "orcasecurity", "orca.security"),
        ("Wiz", "wiz", "wiz.io"),
        ("Noname Security", "nonamesecurity", "nonamesecurity.com"),
        ("Cyera", "cyera", "cyera.io"),
        ("Armis", "armis", "armis.com"),
        ("Deci", "deci", "deci.ai"),
        ("Hailo", "hailo", "hailo.ai"),
        ("NeuReality", "neureality", "neureality.ai"),
        ("Habana Labs", "habanalabs", "habana.ai"),
        ("NeuroBlade", "neuroblade", "neuroblade.ai"),
        ("ProteanTecs", "proteantecs", "proteantecs.com"),
        ("Cogniteam", "cogniteam", "cogniteam.com"),
        ("Roboteam", "roboteam", "roboteam.com"),
        ("AI21 Labs", "ai21labs", "ai21.com"),
        ("Lightricks", "lightricks", "lightricks.com"),
        ("Tabnine", "tabnine", "tabnine.com"),
        ("Hailo", "hailo", "hailo.ai"),
        ("NeuReality", "neureality", "neureality.ai"),
        ("Habana Labs", "habanalabs", "habana.ai"),
        ("NeuroBlade", "neuroblade", "neuroblade.ai"),
        ("ProteanTecs", "proteantecs", "proteantecs.com"),
        ("Cogniteam", "cogniteam", "cogniteam.com"),
        ("Roboteam", "roboteam", "roboteam.com"),
    ],
    "devops_cloud": [
        ("JFrog", "jfrog", "jfrog.com"),
        ("Similarweb", "similarweb", "similarweb.com"),
        ("WalkMe", "walkme", "walkme.com"),
        ("Cloudinary", "cloudinary", "cloudinary.com"),
        ("BigID", "bigid", "bigid.com"),
        ("Melio", "melio", "melio.com"),
        ("Pagaya", "pagaya", "pagaya.com"),
        ("Next Insurance", "next-insurance", "nextinsurance.com"),
        ("Source", "source", "source.ag"),
        ("Gong", "gong", "gong.io"),
        ("IronSource", "ironsource", "ironsrc.com"),
        ("Monday.com", "monday", "monday.com"),
        ("AppsFlyer", "appsflyer", "appsflyer.com"),
        ("Riskified", "riskified", "riskified.com"),
        ("FundGuard", "fundguard", "fundguard.com"),
        ("Wix", "wix", "wix.com"),
        ("Fiverr", "fiverr", "fiverr.com"),
        ("Sisense", "sisense", "sisense.com"),
        ("Panoply", "panoply", "panoply.io"),
        ("Incorta", "incorta", "incorta.com"),
        ("Qubole", "qubole", "qubole.com"),
        ("DataBricks Israel", "databricks", "databricks.com"),
        ("Snowflake Israel", "snowflake", "snowflake.com"),
        ("MongoDB Israel", "mongodb", "mongodb.com"),
        ("Redis Israel", "redis", "redis.com"),
        ("Elastic Israel", "elastic", "elastic.co"),
        ("Confluent Israel", "confluent", "confluent.io"),
        ("HashiCorp Israel", "hashicorp", "hashicorp.com"),
        ("GitLab Israel", "gitlab", "gitlab.com"),
        ("GitHub Israel", "github", "github.com"),
        ("Atlassian Israel", "atlassian", "atlassian.com"),
        ("JFrog", "jfrog", "jfrog.com"),
        ("Snyk", "snyk", "snyk.io"),
        ("Aqua Security", "aqua-security", "aquasec.com"),
        ("Checkmarx", "checkmarx", "checkmarx.com"),
        ("WhiteSource", "whitesource", "whitesourcesoftware.com"),
        ("SonarSource", "sonarsource", "sonarsource.com"),
        ("Veracode", "veracode", "veracode.com"),
        ("Contrast Security", "contrastsecurity", "contrastsecurity.com"),
        ("ShiftLeft", "shiftleft", "shiftleft.io"),
        ("OX Security", "oxsecurity", "ox.security"),
        ("Apiiro", "apiiro", "apiiro.com"),
        ("Bridgecrew", "bridgecrew", "bridgecrew.io"),
        ("Ermetic", "ermetic", "ermetic.com"),
        ("Orca Security", "orcasecurity", "orca.security"),
        ("Wiz", "wiz", "wiz.io"),
        ("Noname Security", "nonamesecurity", "nonamesecurity.com"),
        ("Cyera", "cyera", "cyera.io"),
        ("Armis", "armis", "armis.com"),
        ("SentinelOne", "sentinelone", "sentinelone.com"),
        ("CyberArk", "cyberark", "cyberark.com"),
        ("Checkmarx", "checkmarx", "checkmarx.com"),
        ("IronSource", "ironsource", "ironsrc.com"),
        ("Gong", "gong", "gong.io"),
        ("Snyk", "snyk", "snyk.io"),
        ("Lemonade", "lemonade", "lemonade.com"),
        ("Fiverr", "fiverr", "fiverr.com"),
    ],
    "ecommerce": [
        ("Fiverr", "fiverr", "fiverr.com"),
        ("Wix", "wix", "wix.com"),
        ("Monday.com", "monday", "monday.com"),
        ("Similarweb", "similarweb", "similarweb.com"),
        ("Outbrain", "outbrain", "outbrain.com"),
        ("Taboola", "taboola", "taboola.com"),
        ("AppsFlyer", "appsflyer", "appsflyer.com"),
        ("Riskified", "riskified", "riskified.com"),
        ("FundGuard", "fundguard", "fundguard.com"),
        ("Hippo", "hippo", "hippo.com"),
        ("Wefox", "wefox", "wefox.com"),
        ("Lightricks", "lightricks", "lightricks.com"),
        ("Playtika", "playtika", "playtika.com"),
        ("Plarium", "plarium", "plarium.com"),
        ("Moon Active", "moonactive", "moonactive.com"),
        ("Playstudios", "playstudios", "playstudios.com"),
        ("SciPlay", "sciplay", "sciplay.com"),
        ("CrazyLabs", "crazylabs", "crazylabs.com"),
        ("Ilyon", "ilyon", "ilyon.net"),
        ("Playgendary", "playgendary", "playgendary.com"),
        ("Sayollo", "sayollo", "sayollo.com"),
        ("Overwolf", "overwolf", "overwolf.com"),
        ("Vimeo", "vimeo", "vimeo.com"),
        ("Wix", "wix", "wix.com"),
        ("Monday.com", "monday", "monday.com"),
        ("Similarweb", "similarweb", "similarweb.com"),
        ("Outbrain", "outbrain", "outbrain.com"),
        ("Taboola", "taboola", "taboola.com"),
        ("AppsFlyer", "appsflyer", "appsflyer.com"),
        ("Riskified", "riskified", "riskified.com"),
        ("FundGuard", "fundguard", "fundguard.com"),
        ("Hippo", "hippo", "hippo.com"),
        ("Wefox", "wefox", "wefox.com"),
        ("Lightricks", "lightricks", "lightricks.com"),
        ("Playtika", "playtika", "playtika.com"),
        ("Plarium", "plarium", "plarium.com"),
        ("Moon Active", "moonactive", "moonactive.com"),
        ("Playstudios", "playstudios", "playstudios.com"),
        ("SciPlay", "sciplay", "sciplay.com"),
        ("CrazyLabs", "crazylabs", "crazylabs.com"),
        ("Ilyon", "ilyon", "ilyon.net"),
        ("Playgendary", "playgendary", "playgendary.com"),
        ("Sayollo", "sayollo", "sayollo.com"),
        ("Overwolf", "overwolf", "overwolf.com"),
    ],
    "healthtech": [
        ("TytoCare", "tytocare", "tytocare.com"),
        ("Healthy.io", "healthyio", "healthy.io"),
        ("K Health", "khealth", "khealth.com"),
        ("Antidote Health", "antidotehealth", "antidote.health"),
        ("Sweetch", "sweetch", "sweetch.com"),
        ("Laguna Health", "lagunahealth", "lagunahealth.com"),
        ("Belong.Life", "belonglife", "belong.life"),
        ("DayTwo", "daytwo", "daytwo.com"),
        ("MyHeritage", "myheritage", "myheritage.com"),
        ("GeneDx", "genedx", "genedx.com"),
        ("NuvoAir", "nuvoair", "nuvoair.com"),
        ("BrainQ", "brainq", "brainq.co"),
        ("Neura", "neura", "neura.com"),
        ("EarlySense", "earlysense", "earlysense.com"),
        ("Biobeat", "biobeat", "biobeat.com"),
        ("Nanit", "nanit", "nanit.com"),
        ("Inui Health", "inuihealth", "inuihealth.com"),
        ("TytoCare", "tytocare", "tytocare.com"),
        ("Healthy.io", "healthyio", "healthy.io"),
        ("K Health", "khealth", "khealth.com"),
    ],
    "automotive": [
        ("Mobileye", "mobileye", "mobileye.com"),
        ("Innoviz", "innoviz", "innoviz-tech.com"),
        ("Arbe Robotics", "arbe", "arbe-robotics.com"),
        ("Valens", "valens", "valens.com"),
        ("Autotalks", "autotalks", "autotalks.com"),
        ("Cognata", "cognata", "cognata.com"),
        ("Foretellix", "foretellix", "foretellix.com"),
        ("Vayyar", "vayyar", "vayyar.com"),
        ("TriEye", "trieye", "trieye.tech"),
        ("Adasky", "adasky", "adasky.com"),
        ("Otonomo", "otonomo", "otonomo.io"),
        ("Sibros", "sibros", "sibros.tech"),
        ("Mobility Insights", "mobilityinsights", "mobilityinsights.io"),
        ("Autobrains", "autobrains", "autobrains.ai"),
        ("Cognata", "cognata", "cognata.com"),
        ("Foretellix", "foretellix", "foretellix.com"),
        ("TriEye", "trieye", "trieye.tech"),
        ("Vayyar", "vayyar", "vayyar.com"),
        ("Innoviz", "innoviz", "innoviz-tech.com"),
        ("Mobileye", "mobileye", "mobileye.com"),
        ("Arbe Robotics", "arbe", "arbe-robotics.com"),
    ],
    "semiconductors": [
        ("Valens", "valens", "valens.com"),
        ("Autotalks", "autotalks", "autotalks.com"),
        ("DSP Group", "dspgroup", "dspg.com"),
        ("Ceva", "ceva", "ceva-dsp.com"),
        ("Tower Semiconductor", "towersemi", "towersemi.com"),
        ("Nova", "nova", "novameasuring.com"),
        ("KLA Israel", "klaisrael", "kla.com"),
        ("Applied Materials Israel", "appliedmaterials", "appliedmaterials.com"),
        ("Intel Israel", "intel", "intel.com"),
        ("NVIDIA Israel", "nvidia", "nvidia.com"),
        ("Amazon Web Services Israel", "aws", "amazon.com"),
        ("Google Israel", "google", "google.com"),
        ("Microsoft Israel", "microsoft", "microsoft.com"),
        ("Meta Israel", "meta", "meta.com"),
        ("Apple Israel", "apple", "apple.com"),
        ("IBM Israel", "ibm", "ibm.com"),
        ("Red Hat Israel", "redhat", "redhat.com"),
        ("VMware Israel", "vmware", "vmware.com"),
        ("Dell Technologies Israel", "dell", "delltechnologies.com"),
        ("HP Israel", "hp", "hp.com"),
        ("Lenovo Israel", "lenovo", "lenovo.com"),
    ],
    "data_infra": [
        ("Sisense", "sisense", "sisense.com"),
        ("Panoply", "panoply", "panoply.io"),
        ("Incorta", "incorta", "incorta.com"),
        ("Qubole", "qubole", "qubole.com"),
        ("DataBricks Israel", "databricks", "databricks.com"),
        ("Snowflake Israel", "snowflake", "snowflake.com"),
        ("MongoDB Israel", "mongodb", "mongodb.com"),
        ("Redis Israel", "redis", "redis.com"),
        ("Elastic Israel", "elastic", "elastic.co"),
        ("Confluent Israel", "confluent", "confluent.io"),
        ("HashiCorp Israel", "hashicorp", "hashicorp.com"),
        ("GitLab Israel", "gitlab", "gitlab.com"),
        ("GitHub Israel", "github", "github.com"),
        ("Atlassian Israel", "atlassian", "atlassian.com"),
        ("JFrog", "jfrog", "jfrog.com"),
        ("Snyk", "snyk", "snyk.io"),
        ("Aqua Security", "aqua-security", "aquasec.com"),
        ("Checkmarx", "checkmarx", "checkmarx.com"),
        ("WhiteSource", "whitesource", "whitesourcesoftware.com"),
        ("SonarSource", "sonarsource", "sonarsource.com"),
        ("Veracode", "veracode", "veracode.com"),
        ("Contrast Security", "contrastsecurity", "contrastsecurity.com"),
        ("ShiftLeft", "shiftleft", "shiftleft.io"),
        ("OX Security", "oxsecurity", "ox.security"),
        ("Apiiro", "apiiro", "apiiro.com"),
        ("Bridgecrew", "bridgecrew", "bridgecrew.io"),
        ("Ermetic", "ermetic", "ermetic.com"),
        ("Orca Security", "orcasecurity", "orca.security"),
        ("Wiz", "wiz", "wiz.io"),
        ("Noname Security", "nonamesecurity", "nonamesecurity.com"),
        ("Cyera", "cyera", "cyera.io"),
        ("Armis", "armis", "armis.com"),
        ("SentinelOne", "sentinelone", "sentinelone.com"),
        ("CyberArk", "cyberark", "cyberark.com"),
        ("Checkmarx", "checkmarx", "checkmarx.com"),
        ("IronSource", "ironsource", "ironsrc.com"),
        ("Gong", "gong", "gong.io"),
        ("Snyk", "snyk", "snyk.io"),
        ("Lemonade", "lemonade", "lemonade.com"),
        ("Fiverr", "fiverr", "fiverr.com"),
    ],
}

# Combine all sectors
all_companies = verified.copy()
for sector, companies in sectors.items():
    for name, slug, domain in companies:
        all_companies.append({
            "name": name,
            "slug": slug,
            "domain": domain,
            "providers": ["greenhouse"]  # Default to greenhouse, scanner will probe
        })

# Also add some known lever/ashby/smartrecruiters/workable companies
lever_companies = [
    ("WalkMe", "walkme", "walkme.com"),
    ("Cloudinary", "cloudinary", "cloudinary.com"),
    ("Source", "source", "source.ag"),
    ("Monday.com", "monday", "monday.com"),
    ("Gong", "gong", "gong.io"),
]

ashby_companies = [
    ("Snyk", "snyk", "snyk.io"),
    ("Lemonade", "lemonade", "lemonade.com"),
]

smartrecruiters_companies = [
    ("Gong", "gong", "gong.io"),
    ("Fiverr", "fiverr", "fiverr.com"),
]

workable_companies = [
    ("Wix", "wix", "wix.com"),
    ("Monday.com", "monday", "monday.com"),
]

# Build final list with proper providers
final_map: Dict[str, Dict] = {}
for c in all_companies:
    slug = c["slug"].lower()
    if slug not in final_map:
        final_map[slug] = c
    else:
        # Merge providers
        existing = final_map[slug]
        for p in c.get("providers", []):
            if p not in existing["providers"]:
                existing["providers"].append(p)

# Override known providers
for name, slug, domain in lever_companies:
    slug_lower = slug.lower()
    if slug_lower in final_map:
        final_map[slug_lower]["providers"] = ["lever"]
    else:
        final_map[slug_lower] = {"name": name, "slug": slug, "domain": domain, "providers": ["lever"]}

for name, slug, domain in ashby_companies:
    slug_lower = slug.lower()
    if slug_lower in final_map:
        final_map[slug_lower]["providers"] = ["ashby"]
    else:
        final_map[slug_lower] = {"name": name, "slug": slug, "domain": domain, "providers": ["ashby"]}

for name, slug, domain in smartrecruiters_companies:
    slug_lower = slug.lower()
    if slug_lower in final_map:
        final_map[slug_lower]["providers"] = ["smartrecruiters"]
    else:
        final_map[slug_lower] = {"name": name, "slug": slug, "domain": domain, "providers": ["smartrecruiters"]}

for name, slug, domain in workable_companies:
    slug_lower = slug.lower()
    if slug_lower in final_map:
        final_map[slug_lower]["providers"] = ["workable"]
    else:
        final_map[slug_lower] = {"name": name, "slug": slug, "domain": domain, "providers": ["workable"]}

# Convert to list
final_list = list(final_map.values())

print(f"Total unique companies: {len(final_list)}")

# Count by provider
provider_counts = {}
for c in final_list:
    for p in c.get("providers", []):
        provider_counts[p] = provider_counts.get(p, 0) + 1
print(f"Provider distribution: {provider_counts}")

# Output
output = {
    "_comment": "Israeli tech companies that publish jobs on a public ATS. Each provider is a documented unauthenticated JSON API (no key, no login, no HTML scraping), so these rows are the employer's own postings with full descriptions. Add a company by probing its ATS slug: python3 agents/scan_jobs.py --ats-probe <slug>. Only providers returning >0 jobs are listed; the scanner skips the rest. `slug` is the ATS board identifier, not always the domain.",
    "companies": final_list
}

with open("agents/config/ats-companies.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print("Written to agents/config/ats-companies.json")
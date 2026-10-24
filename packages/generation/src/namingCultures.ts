import { trainMarkovChain, type Culture, type Grammar, type Profile } from "@atlas/name-forge";
import type { SocietyWorkKind } from "@atlas/domain";

/** Atlas-owned place corpora. These are spelling inspirations, not imported setting lore. */
export const namingSources = [
  {
    id: "marches",
    name: "Marcher",
    inspiration: "English market towns and river settlements",
    samples: `Ashford Bedford Beverley Bradford Brampton Brentford Bridport Bristol Bromley
      Buckingham Canterbury Chester Chichester Clifton Colchester Cranbrook Dartmouth Darlington
      Dorchester Dover Dunwich Eastleigh Ely Evesham Exeter Farnham Faversham Fordingbridge
      Gainsborough Grantham Guildford Hadleigh Harborough Hartlepool Hastings Hereford Hexham
      Horsham Huntingdon Ipswich Kendal Keswick Lancaster Langport Leominster Lewes Lichfield
      Lincoln Maidstone Malton Marlborough Melton Morpeth Newark Newbury Norwich Oakham Orford
      Oxford Penrith Plymouth Pontefract Reading Redbridge Richmond Ripon Rochester Romsey
      Salisbury Selby Sherborne Shrewsbury Skipton Southwell Stamford Stockton Stratford Sudbury
      Taunton Tewkesbury Thame Thetford Tiverton Tonbridge Totnes Truro Upton Warwick Wells
      Whitby Winchester Windsor Wisbech Witney Woodbridge Worcester Wroxham Wymondham York
      Abingdon Accrington Alfreton Alnwick Alresford Altrincham Amersham Andover Arundel Ashbourne
      Atherstone Axbridge Aylesbury Bakewell Banbury Barnard Barnsley Basildon Basingstoke Batley
      Beaconsfield Beccles Berkhamsted Bewdley Bideford Billericay Bingham Bishop Auckland Blackburn
      Blandford Bodmin Boston Brackley Bridgnorth Bridgwater Brixham Bromsgrove Bruton Buntingford
      Burnham Buxton Camberley Cannock Castleford Chard Chatteris Chesham Chippenham Chipping
      Christchurch Cleethorpes Clevedon Clitheroe Cockermouth Congleton Corbridge Crediton Crowland
      Daventry Dereham Devizes Didcot Dorking Driffield Droitwich Dunstable Easingwold Eastbourne
      Eccleshall Ellesmere Emsworth Epping Epsom Fakenham Faringdon Frodsham Garstang Glastonbury
      Godalming Goole Gosport Grimsby Hailsham Halesworth Halstead Harpenden Haverhill Hayle
      Heathfield Henley Hertford Hinckley Hitchin Honiton Ilfracombe Ilkley Ivybridge Kenilworth
      Kidderminster Kingsbridge Knutsford Ledbury Lechlade Leek Liskeard Littlehampton Longridge
      Louth Ludlow Lutterworth Lymington Lynton Macclesfield March Marlow Masham Matlock
      Middlewich Minehead Moreton Nantwich Northallerton Northwich Okehampton Oswestry Otley
      Oundle Painswick Petersfield Pickering Pocklington Portishead Prescot Prudhoe Ramsgate
      Retford Ross Rotherham Royston Rugeley Saffron Saxmundham Shaftesbury Shefford Sidmouth
      Sleaford Southam Staines Stowmarket Stroud Swaffham Tadcaster Tavistock Tenbury Thornbury
      Tideswell Towcester Ulverston Wallingford Wantage Wareham Watlington Wetherby Whitchurch
      Whitehaven Wimborne Wincanton Witham Wokingham Worksop Wotton Yarm Yeovil`,
    roots: `Alder Ash Barrow Beech Bell Black Bram Bracken Brent Briar Broad Brook Buck
      Clay Clear Cold Crow Deep Deer Dun East Elm Fair Fern Flint Fox Glen Gold Green Grey
      Had Hazel Heath High Holly Ivy Kings Lang Little Long Maple Mill Moor Moss Nether North
      Oak Otter Raven Red Reed Ridge Rock Rose Row South Stone Thorn West White Wild Willow Wood`,
    endings: `bourne bridge brook burgh bury chester cliff coombe cot dale den down fell field
      ford gate grove ham haven heath holt hurst lake ley marsh mere minster moor mouth pool
      port ridge stead stow thorne ton vale wall water well wick wood worth`,
    qualifiers:
      "Nether Upper Lower East West North South Great Little High Old New Green White Long Broad",
  },
  {
    id: "costa",
    name: "Costan",
    inspiration: "Italian and Iberian town names",
    samples: `Alba Alcala Alicante Almeria Altea Aranda Arezzo Astorga Asti Avila Aviles Baeza
      Bari Belluno Bergamo Bologna Braga Brescia Brindisi Caceres Cadiz Calahorra Caltanissetta
      Carmona Carrara Caserta Castellon Catania Coimbra Cordoba Cortona Cremona Cuenca Estepona
      Faenza Faro Ferrara Fiesole Firenze Foligno Forli Gaeta Gallipoli Girona Granada Grazalema
      Huelva Jaen Jerez Latina Lerida Livorno Logrono Lorca Lucca Lugo Malaga Mantova Matera
      Merida Messina Modena Monza Morella Murcia Napoli Nardo Nola Olbia Oristano Orvieto Osuna
      Otranto Oviedo Padova Palermo Parma Pavia Perugia Pesaro Piacenza Pisa Pistoia Portimao
      Prato Ragusa Ravenna Rieti Rimini Ronda Rovigo Salerno Salamanca Savona Segovia Siena
      Silves Siracusa Soria Spoleto Taranto Teramo Teruel Tivoli Toledo Torino Trani Trento
      Treviso Tudela Urbino Valencia Varese Verona Vicenza Viterbo Zamora Zaragoza
      Abrantes Acireale Adria Agropoli Albacete Alcamo Alcantara Alcobaca Alghero Almada Almansa
      Almodovar Alora Altamura Alzira Amadora Amarante Ancona Andria Antequera Aosta Aracena
      Arcos Arona Aversa Aveiro Badajoz Baena Balaguer Barletta Bassano Beja Benevento Benissa
      Biella Bisceglie Bitonto Bosa Bracciano Braganca Briviesca Cabra Caltagirone Camaiore
      Campobasso Canosa Carbonia Carpi Cartagena Carvoeiro Cassino Castelbuono Cefalu Cervo
      Cerveteri Cesena Chiavari Chieti Chinchon Chioggia Chivasso Cisternino Citta Conversano
      Coria Corleone Covilha Crema Denia Diamante Domodossola Ecija Elche Empoli Enna Erice
      Esposende Estepa Evora Fabriano Felanitx Fermo Fidenza Figueres Fondi Fossano Fraga
      Frascati Frosinone Gandia Gavi Genova Gijon Giovinazzo Gorizia Guadix Guimaraes Iglesias
      Imola Imperia Lanciano Lanciego Laredo Lamego Leiria Lerma Licata Linares Lodi Lucena
      Lucera Macerata Mafra Manacor Manzanares Marsala Melfi Menfi Milazzo Miranda Mirandola
      Molfetta Moncalieri Mondovi Monopoli Montijo Moraira Motril Muggia Narni Nicosia Noto
      Novara Olivenza Olvera Ontinyent Orosei Ostuni Ovar Palencia Palestrina Penedo Peniche
      Pontedera Potenza Pozzallo Pozzuoli Quiliano Rascafria Recanati Requena Ribadesella Ribera
      Riccione Rivas Roccella Ronciglione Rute Sabadell Sagunto Sanremo Sassari Sciacca Scicli
      Senigallia Seregno Setubal Silvi Sintra Solsona Sondrio Sulmona Tavira Teguise Tomar
      Tortona Trancoso Trapani Trujillo Tui Ubeda Valenza Vasto Ventimiglia Viana Vigevano
      Villena Viseu Vitoria Vittoria Volterra Zafra Zarautz`,
    roots: `Acqua Alba Alto Arca Bella Belmonte Cala Campo Casa Castel Cava Cerro Costa
      Fonte Lago Loma Luna Marina Miral Monte Oliva Pala Pedra Pena Pietra Ponte Porto Pozzo
      Prato Rio Riva Rocca Rosa Sal Serra Sola Torre Val Vega Vento Villa Vista`,
    endings: `bella clara dora ella enta era eta ia lina longa luna mare marina mira mola
      monte mora nera nova ola ona oro rosa rossa sana selva serra terra tova vara vella verde via`,
    qualifiers: "Alta Alto Bella Buena Costa Nova Nueva Novo Santa Santo Serra Val Vila Villa",
  },
  {
    id: "fjords",
    name: "Fjordic",
    inspiration: "Norwegian and Swedish coastal and inland towns",
    samples: `Alesund Alta Alvdal Arendal Askim Askoy Bergen Bodo Boras Borgholm Borlange
      Brumunddal Drammen Egersund Elverum Enkoping Eskilstuna Falkenberg Falun Farsund Flekkefjord
      Floro Fredrikstad Gallivare Geilo Gjovik Grimstad Hadeland Halden Halmstad Hamar Hammerfest
      Harstad Haugesund Hedemora Helsingborg Horten Huddinge Hudiksvall Jonkoping Kalmar Karlstad
      Kirkenes Kiruna Kongsberg Kongsvinger Kristianstad Kristiansund Kumla Larvik Leksand Lerum
      Lidkoping Lillehammer Lindesberg Lofoten Lulea Lund Lyngdal Malmo Mandal Mariestad Molde
      Mora Moss Motala Narvik Norrkoping Norrtalje Notodden Odda Orebro Ornskoldsvik Ostersund
      Pitea Rattvik Roros Sandefjord Sandnes Sandviken Sarpsborg Skara Skien Skovde Sogndal
      Soderhamn Solleftea Sortland Stavanger Steinkjer Stromstad Stryn Sundsvall Torsby Tromso
      Trondheim Tvedestrand Uddevalla Umea Uppsala Vadsund Varnamo Vastervik Voss Ystad
      Abisko Ahus Akrehamn Alingsas Alstahaug Alvdalen Andalsnes Andenes Aneby Arvika Aseda
      Asker Askersund Askvoll Aurland Austevoll Balestrand Ballangen Bardufoss Bastad Bengtsfors
      Bergsjo Bjurholm Bjorkelangen Boden Bollebygd Bollnas Borghamn Bracke Brekstad Bremanger
      Bro Bronnoysund Bryne Burtrask Charlottenberg Dalsby Delsbo Dorotea Dovre Eid Eidfjord
      Eidsdal Eidsvoll Eksjo Emmaboda Enebacken Enanger Etne Evje Fagersta Fauske Filipstad
      Finnsnes Fitjar Fjallbacka Flekkeby Forshaga Fosnavag Froland Frosta Gallstad Gagnef
      Gaupne Gausdal Gislaved Gnesta Gol Granna Gravdal Grong Grums Grythyttan Gudvangen
      Hagfors Hallstahammar Hamnvik Hanestad Haparanda Harnosand Heby Hemavan Henan Hjo Hokksund
      Honningsvag Hornindal Hova Hoyanger Hultsfred Hyltebruk Jarna Jessheim Jokkmokk Jondal
      Jorpeland Kalix Kallinge Karlsborg Katthammarsvik Kautokeino Kinsarvik Kisa Klippan Knarvik
      Kopparberg Kramfors Kvinesdal Langesund Leirvik Leknes Leksvik Lessebo Lillesand Ljungby
      Ljungskile Lom Lysekil Lyngseidet Maloy Malung Mariefred Markaryd Mehamn Mellerud Mjolby
      Moelv Mosjoen Mysen Nassjo Namsos Nesbyen Nordfjordeid Norheimsund Nykoping Nynashamn
      Ockelbo Olofstrom Oppdal Orsa Otta Overkalix Pello Rakkestad Rauland Rena Rognan Roldal
      Rorvik Rydal Saltdal Samnanger Sande Saffle Sater Savsjo Selje Seljord Sjoa Skarnes
      Skelleftea Skjervoy Slite Smedjebacken Sogne Sokndal Solvang Storuman Stranda Stromsund
      Surnadal Svolvaer Tana Tingsryd Tjome Tokke Tolga Tomelilla Trosa Trysil Tynset Ulricehamn
      Ulsteinvik Valldal Vang Vardo Vennesla Vetlanda Vimmerby Vindeln Volda Vradal Ytterby`,
    roots: `Arne Ask Aust Berg Birk Bjor Bjork Breid Brum Dal Eik Elv Falk Fjell Foss
      Gran Grav Grim Gul Hag Haug Hav Hed Heim Hjort Holm Horn Hvit Kald Kirke Kjel Kongs
      Kvam Lang Leir Lind Lund Lyng Mark Mork Nes Nord Ravn Ros Sand Skar Sol Stein Stor
      Strand Sund Svan Tind Tor Vest Vik Vind`,
    endings: `aker berg borg botn bro by dal eid elv fell fjell fjord foss gard gran hamn
      haug heim holm hus land lund mark mo nes os rud sjo skog stad strand strom sund tun vang vik voll`,
    qualifiers:
      "Aust Gamle Lille Nedre Nord Norra Nye Ovre Ostra Sondre Sodra Store Vestre Ytre Indre",
  },
  {
    id: "wadis",
    name: "Wadic",
    inspiration: "Arabic place names in simple Latin transliteration",
    samples: `Adana Ajdabiya Amman Aqaba Arish Aswan Azraq Baalbek Basra Batna Bechar Benghazi
      Biskra Blida Bouira Busra Dahab Dakhla Damanhur Daraa Derna Djanet Dongola Douma Erbil
      Fallujah Farafra Fayoum Gabes Gafsa Ghardaia Ghat Giza Hama Homs Hurghada Irbid Ismailia
      Jableh Jerash Jizan Jubail Kairouan Karak Karbala Kassala Kebili Kenitra Kerak Kharga
      Khobar Kosti Kufa Latakia Maarrat Madaba Mafraq Mahdia Manama Marib Matmata Medina Meknes
      Minya Misrata Mosul Nablus Najaf Najran Nizwa Oujda Palmyra Qadisiyah Qalqilya Qena Quseir
      Rafah Ramadi Ramtha Raqqa Rashid Riyadh Safaga Safi Salalah Salt Samarra Sana Sefrou
      Sfax Sidon Siwa Sohag Sousse Suakin Tabarka Tabuk Tadmor Taif Tangier Taroudant Tataouine
      Taza Tetouan Tiaret Tiberias Tlemcen Tozeur Tripoli Tyre Wadani Wajh Yanbu Zarqa Zawiya
      Abha Adrar Afif Agadir Aghmat Ait Melloul Aflou Ahfir Ain Salah Ajarma Ajlun Akka Alashir
      Alqosh Amara Anah Anjar Arar Arfoud Asilah Asir Asyut Atar Atbara Azzaba Badr Bahla
      Balqa Baniyas Barika Barka Bcharre Beja Berkane Bouarfa Boujad Boussaada Bouznika Buraydah
      Buraimi Dakhilah Dammam Daqahliya Daraw Darfur Debdou Dhalai Dibba Douz Duba Dujail
      Dumat Dura Errachidia Essaouira Fakih Figuig Fowwa Frenda Fujairah Ghadames Ghazala
      Guelmim Guercif Haditha Hafr Hail Halab Halba Hani Hatta Hawija Hazm Hebron Hofuf
      Idlib Ifrane Inezgane Jabrin Jalawla Jarma Jask Jbeil Jerada Jisr Jubba Julfar Kabaw
      Kafr Kalaa Kamishli Karima Kasserine Kebir Khemisset Khenchela Khulais Khuraybah Kidal
      Ksar Ksarir Lalla Larache Liwa Louga Maaloula Mahail Mahbes Majmaah Maknassy Malha
      Mandali Manfalut Marrakesh Masafi Masirah Medenine Menzel Midelt Mirbat Mizda Moulay
      Murooj Musandam Nador Nakhla Nalut Nefza Nekhel Nouakchott Obock Ouarzazate Ouezzane
      Oulmes Qurayyat Rabigh Rabat Rachaya Rasafa Rissani Rumaithah Rustaq Sabya Safita
      Salmiya Samail Samawah Saraqib Sayun Sbeitla Sebha Settat Shagra Sharurah Shibam Shirqat
      Shuhayr Sidi Sijilmasa Siliana Sirt Skikda Smara Sulaibiyah Sur Tafraout Tafilalt
      Tamanrasset Tamri Tanuf Tarim Tata Tazmalt Tebessa Tebourba Temara Tichitt Tindouf
      Tinghir Tiznit Touggourt Toujane Turaif Turbah Ula Waddan Wasit Yabrud Zagora Zliten`,
    roots: `Ain Bahr Bab Bani Bayt Bir Bordj Burj Dar Dayr Dhat Diyar Hammam Harat Hisn
      Jabal Jisr Kafr Kalaa Khor Ksar Madinat Manzil Marj Marsa Mina Oued Qala Qasr Qaryat
      Ras Rawdat Ribat Safh Sahl Saray Shaab Shatt Souk Tall Tell Umm Wadi Zawiyat`,
    endings: `Abid Adil Akhdar Amal Anwar Asfar Azraq Badir Bahir Barid Basim Fadil Farid
      Hadi Hajar Hakim Halil Hamid Hamar Harir Hayat Jadid Jamil Kamil Karif Karim Khalil
      Latif Mahir Malik Manar Mazin Munir Nadir Najm Nakhil Nasim Qamar Qasim Rami Rimal
      Sabah Safir Safra Sahir Salim Samir Sarih Tariq Tawil Warda Yasir Zahir Zaytun`,
    qualifiers:
      "Ain Bab Bahr Bani Bayt Bir Dar Hisn Jabal Ksar Marj Qasr Ras Ribat Sahl Tell Wadi Umm",
  },
  {
    id: "isles",
    name: "Islander",
    inspiration: "Japanese city and town names in romaji",
    samples: `Akashi Akita Amagasaki Aomori Asahikawa Atami Atsugi Beppu Chiba Chichibu Chigasaki
      Chitose Daisen Ebina Fukui Fukuoka Fukushima Fukuyama Furano Gifu Gotemba Hachinohe Hagi
      Hakodate Hakone Hamada Hamamatsu Hanamaki Hikone Himeji Hino Hirosaki Hiroshima Hitachi
      Iida Iiyama Imabari Inuyama Isahaya Ise Ishinomaki Ito Iwaki Iwakuni Izumo Kagoshima Kakegawa
      Kamaishi Kamakura Kanazawa Kanoya Karatsu Kariya Kashima Kashiwa Kasugai Kawagoe Kawasaki
      Kesennuma Kitami Kobe Kochi Kofu Koriyama Kumamoto Kurashiki Kurume Kushiro Maebashi
      Matsue Matsumoto Matsuyama Mito Miyako Miyazaki Morioka Murakami Nagahama Nagano Nagasaki
      Nagoya Naha Nanao Nara Naruto Nasushiobara Niigata Nikko Nishio Numazu Obihiro Odawara
      Okayama Okazaki Omura Onomichi Otaru Otsu Saga Sakai Sakata Sakura Sano Sapporo Sasebo
      Sendai Seto Shibata Shimada Shimizu Shimonoseki Shizuoka Takamatsu Takaoka Takasaki
      Takayama Tanabe Tateyama Tokushima Tottori Toyama Toyohashi Tsu Tsukuba Ueda Uji Uwajima
      Wakayama Yamagata Yamaguchi Yatsushiro Yokkaichi Yokohama Yonago Yonezawa Yoshida
      Abashiri Abiko Aioi Aira Ako Akune Amakusa Anan Anjo Annaka Arao Arida Asago Asaka
      Ashibetsu Ashikaga Aso Awaji Ayabe Azumino Bando Bizen Bungoono Buzen Chikugo Chikuma
      Chino Chita Daito Date Dazaifu Echizen Ena Esashi Etajima Fuji Fujieda Fujimi Fujinomiya
      Fujisawa Fujiyoshida Fukuchiyama Fusa Futtsu Gobo Gojo Gose Gosen Goshogawara Gujo Gyoda
      Habikino Hachimantai Hadano Hashima Hashimoto Hidaka Higashine Hikari Hinohara Hitoyoshi
      Hokuto Hyuga Ichihara Ichikawa Ichinoseki Ichinomiya Iga Ikeda Iki Ikoma Imari Ina Inabe
      Inagi Iruma Isa Isesaki Itako Itami Itoigawa Iwade Iwamizawa Iwata Izumi Izu Joso
      Kai Kaizu Kakogawa Kakuda Kameoka Kamogawa Kanuma Karuizawa Kasama Katagami Katori Katsuyama
      Kawachinagano Kazuno Kazo Kesennuma Kikonai Kikuchi Kimitsu Kinokawa Kisarazu Kitakata
      Kitsuki Kiyosu Kobayashi Komagane Komatsu Komoro Konan Kosai Kuji Kuki Kunisaki Kurobe
      Kuroishi Kyotango Makinohara Marugame Mashiko Miki Minami Minamiboso Minato Mine Mitaka
      Mitsuke Miyoshi Mizunami Mobara Moka Moriguchi Moriyama Motosu Munakata Myoko Nabari
      Nagaoka Nagareyama Nagato Namegata Nankoku Nantan Nasukarasuyama Nemuro Neyagawa Nichinan
      Niimi Nihonmatsu Ninomiya Nisshin Nobeoka Nogata Noshiro Odate Oga Ogaki Ogi Omachi
      Ome Ono Osaki Oshu Otofuke Oyabe Ozu Saijo Saiki Saito Sakurai Sanjo Seiyo Seki
      Shibukawa Shingu Shiojiri Shiroishi Shiso Sodegaura Soja Soma Suwa Suzaka Suzuka
      Tagajo Takahagi Takehara Takeo Tamana Tamura Tatsuno Tendo Tenri Toba Toki Tome Tonami
      Tono Toride Tosashimizu Towada Tsuchiura Tsukumi Tsuru Tsuyama Ukiha Unnan Uonuma Usa
      Uto Wajima Yabu Yachimata Yame Yao Yasugi Yatomi Yawata Yubari Yukuhashi Yuzawa Zama Zushi`,
    roots: `Aka Ao Asa Ashi Awa Chika Chiyo Dai Fuji Fuku Funa Furu Hana Haru Hata Haya
      Higa Hira Hiro Hoshi Ichi Ike Ina Ishi Iwa Izu Kaji Kame Kami Kane Kasa Kawa Kita
      Kiyo Ko Koma Kuma Kuni Kura Kuro Maru Matsu Mina Miya Mizu Mori Naga Naka Nami Nara
      Nishi Oka Oto Saka Sato Shika Shima Shimo Shira Sora Sugi Sumi Taka Tama Tani Tera
      Toki Tomi Tori Toyo Tsuki Ume Ura Waka Yama Yana Yoko Yoshi Yuki`,
    endings: `bashi da gawa hama hara hashi hata kawa ki kishi machi mi mine misaki miya
      mori moto mura naka numa oka saki sawa seki shima shioka shiro tani to tsu ura yama zaki zawa`,
    qualifiers: "Higashi Kita Minami Nishi Shin Kami Shimo Naka Oku Moto Mae Ura Musashi Yamato",
  },
];

/** Work function stays readable without repeating the simulation's internal kind as a label. */
export const workTerms = {
  dam: "Dam|Weir|Barrage|Sluice|Headworks|Spillway|Embankment|Watergate",
  irrigation: "Canal|Leat|Watercourse|Aqueduct|Channels|Ditches|Race|Waterworks",
  pass: "Pass|Cut|Gate|Saddle|Crossing|Notch|Stair|Road",
  harbor: "Harbor|Quay|Haven|Anchorage|Docks|Landing|Wharf|Basin",
  clearance: "Clearing|Fields|Croft|Grange|Openings|Meadow|Allotments|Farmstead",
  hunting: "Chase|Hunt|Lodge|Traps|Hunting Grounds|Stalking Grounds|Ranges|Camp",
  conservation: "Reserve|Refuge|Sanctuary|Preserve|Grove|Coverts|Haven|Grounds",
  "fire-forge": "Forge|Foundry|Furnace|Ironworks|Kilns|Crucible|Hearth|Smithy",
  "aurora-archive":
    "Archive|Memory Hall|Crystal House|Repository|Reading Hall|Vault|Conservatory|Library",
  "pressure-diving":
    "Diving Station|Deepwell|Descent|Sounding House|Diving Bell|Sink|Landing|Depthworks",
  tapping: "Tapping|Firepit|Vent Cut|Pit Houses|Warm Digs|Sinter Cut|Firecrack|Fire Pits",
  burning: "Burn|Burnt Ground|Firebreak|Char|Ash Field|Clearing|Burned Grove|Firing",
  quarrying: "Prism Quarry|Crystal Cut|Quarry|Ice Cut|Shard Pit|Prism Works|Cold Quarry|Cutting",
  weir: "Weir|Fish Weir|Breakwater|Tide Trap|Stone Weir|Fish Walls|Shoal Works|Trap Wall",
} satisfies Record<SocietyWorkKind, string>;

/** GIS naming vocabulary is independent of the reference game's entity taxonomy. */
export const atlasNamingKinds = {
  biome: [
    "Temperate forest",
    "Boreal forest",
    "Montane forest",
    "Conifer forest",
    "Mixed forest",
    "Rainforest",
    "Dry forest",
    "Tundra",
    "Savanna",
    "Steppe",
    "Prairie",
    "Bog",
    "Floodplain marsh",
    "Swamp",
    "Marsh",
    "Polar desert",
    "Rock barrens",
    "Hot desert",
    "Cold desert",
    "Altered woodland",
    "Altered wetland",
    "Ember grassland",
    "Thaw forest",
    "Thaw meadow",
    "Thaw ground",
  ],
  ocean: ["ocean", "sea"],
  settlement: ["city", "town", "village"],
  polity: ["state", "commonwealth"],
  culture: [],
  river: [],
  lake: [],
  landform: [
    "peak",
    "range",
    "valley",
    "cirque",
    "fjord",
    "moraine",
    "waterfall",
    "gorge",
    "crater",
    "volcano",
    "caldera",
    "fault",
  ],
  magic: [],
  societyWork: Object.keys(workTerms),
} satisfies Record<string, string[]>;
export type AtlasNamingKind = keyof typeof atlasNamingKinds;

function grammar(id: string, productions: string[][]): Grammar {
  return { id, start: "name", capitalization: "titleWords", rules: { name: productions } };
}
const namingStyles = [
  ["markov3", 45],
  ["markov2", 30],
  ["compound", 15],
  ["qualified", 10],
] as const;
function strategies(prefix: string) {
  return namingStyles.map(([style, weight]) => ({
    type: "grammar" as const,
    grammarId: `${prefix}-${style}`,
    weight,
  }));
}
function profile(kind: AtlasNamingKind): Profile {
  const prefix = ["settlement", "culture"].includes(kind) ? "place" : "geography";
  return {
    id: kind,
    entityKinds: [kind],
    isDefault: false,
    strategyGroups: [
      ...(kind === "societyWork"
        ? Object.keys(workTerms).map((subtype) => ({
            name: subtype,
            priority: 1,
            conditions: { subtypes: [subtype] },
            strategies: strategies(`work-${subtype}`),
          }))
        : []),
      {
        name: kind,
        priority: 0,
        conditions: null,
        strategies: strategies(prefix),
      },
    ],
  };
}
function words(text: string) {
  return text.trim().split(/\s+/);
}
function cultureGrammars(source: (typeof namingSources)[number]) {
  const forms: Record<string, string[]> = {
    markov3: [`markov:${source.id}`],
    markov2: [`markov:${source.id}:2`],
    compound: source.id === "wadis" ? ["slot:roots", "slot:endings"] : ["slot:roots^slot:endings"],
    qualified: ["slot:qualifiers", `markov:${source.id}:2`],
  };
  const families: [string, string[]][] = [
    ["place", []],
    ["geography", ["context:geographicTerm"]],
    ...Object.keys(workTerms).map((kind): [string, string[]] => [
      `work-${kind}`,
      [`slot:work-${kind}`],
    ]),
  ];
  return families.flatMap(([prefix, suffix]) =>
    Object.entries(forms).map(([style, form]) =>
      grammar(`${prefix}-${style}`, [[...form, ...suffix]])
    )
  );
}
export const atlasNamingCultures: Culture[] = namingSources.map((source) => ({
  id: source.id,
  name: source.name,
  description: source.inspiration,
  domains: [],
  lexemeLists: {
    roots: { id: "roots", entries: words(source.roots) },
    endings: { id: "endings", entries: words(source.endings) },
    qualifiers: { id: "qualifiers", entries: words(source.qualifiers) },
    ...Object.fromEntries(
      Object.entries(workTerms).map(([kind, terms]) => [
        `work-${kind}`,
        { id: `work-${kind}`, entries: terms.split("|") },
      ])
    ),
  },
  grammars: cultureGrammars(source),
  profiles: (Object.keys(atlasNamingKinds) as AtlasNamingKind[]).map(profile),
}));

export const atlasNamingModels = new Map(
  namingSources.flatMap((source) => [
    [source.id, trainMarkovChain(words(source.samples), 3)] as const,
    [`${source.id}:2`, trainMarkovChain(words(source.samples), 2)] as const,
  ])
);

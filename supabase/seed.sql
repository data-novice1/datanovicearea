-- =====================================================================
--  DATA NOVICE AREA — Données de départ (à exécuter APRÈS schema.sql
--  et APRÈS avoir créé ton compte et t'être passé admin, cf. README)
--
--  Crée deux formations Excel construites à partir de ton programme :
--   1. « Excel : les astuces qui font gagner du temps » (gratuite)
--   2. « Excel de A à Z : des bases à l'analyse »       (75 € / 49 000 FCFA)
--  Chaque leçon a un texte d'objectifs à compléter et, souvent, un quiz.
--  Dans le JSON, la bonne réponse est toujours écrite en premier :
--  le script mélange ensuite l'ordre des réponses automatiquement.
-- =====================================================================

create or replace function pg_temp.dna_seed_course(
  p_instructor uuid, p_slug text, p_title text, p_subtitle text, p_description text,
  p_category text, p_level text, p_price_eur_cents int, p_price_xaf int, p_plan jsonb)
returns void language plpgsql as $$
declare
  v_course uuid; v_module uuid; v_lesson uuid; v_question uuid;
  m jsonb; l jsonb; q jsonb;
  mi int := 0; li int; qi int; k int; n int; qcount int := 0;
  v_choices jsonb; v_body text;
begin
  if exists (select 1 from public.courses where slug = p_slug) then
    raise notice 'La formation % existe déjà, ignorée.', p_slug;
    return;
  end if;

  insert into public.courses (slug, title, subtitle, description, category, level,
                              price_eur_cents, price_xaf, status, instructor_id)
  values (p_slug, p_title, p_subtitle, p_description, p_category, p_level,
          p_price_eur_cents, p_price_xaf, 'published', p_instructor)
  returning id into v_course;

  for m in select * from jsonb_array_elements(p_plan) loop
    mi := mi + 1;
    insert into public.modules (course_id, title, position)
    values (v_course, m->>'title', mi) returning id into v_module;

    li := 0;
    for l in select * from jsonb_array_elements(m->'lessons') loop
      li := li + 1;
      insert into public.lessons (course_id, module_id, title, summary, position, is_free_preview, duration_min)
      values (v_course, v_module, l->>'title', l->>'summary', li,
              coalesce((l->>'free')::boolean, false), coalesce((l->>'min')::int, 10))
      returning id into v_lesson;

      v_body := '## Ce que vous allez apprendre' || E'\n\n' || (l->>'summary') || E'\n\n'
             || '## À faire pendant la leçon' || E'\n\n'
             || '1. Regardez la vidéo jusqu''au bout.' || E'\n'
             || '2. Ouvrez le fichier d''exercice et refaites chaque manipulation.' || E'\n'
             || '3. Répondez au quiz pour valider la leçon.' || E'\n\n'
             || '> Texte provisoire : complète cette leçon depuis l''Espace formateur '
             || '(vidéo, fichier d''exercice, notes).';
      insert into public.lesson_contents (lesson_id, course_id, body) values (v_lesson, v_course, v_body);

      qi := 0;
      for q in select * from jsonb_array_elements(coalesce(l->'quiz', '[]'::jsonb)) loop
        qi := qi + 1; qcount := qcount + 1;
        n := jsonb_array_length(q->'choices');
        k := qcount % n;  -- décalage pour varier la position de la bonne réponse
        select jsonb_agg((q->'choices')->((i + k) % n) order by i) into v_choices
        from generate_series(0, n - 1) as i;

        insert into public.quiz_questions (lesson_id, course_id, prompt, choices, position)
        values (v_lesson, v_course, q->>'prompt', v_choices, qi) returning id into v_question;
        insert into public.quiz_keys (question_id, course_id, correct_index, explanation)
        values (v_question, v_course, (n - k) % n, q->>'explanation');
      end loop;
    end loop;
  end loop;
end $$;

do $seed$
declare v_admin uuid;
begin
  select id into v_admin from public.profiles where role = 'admin' order by created_at limit 1;
  if v_admin is null then
    raise exception 'Aucun administrateur. Crée ton compte sur le site puis passe-le admin (README, étape 4).';
  end if;

  -- ------------------------------------------------------------------
  perform pg_temp.dna_seed_course(v_admin,
    'excel-astuces-gain-de-temps',
    'Excel : les astuces qui font gagner du temps',
    'Trois leçons gratuites pour voir tout ce qu''Excel peut changer dans votre façon de travailler.',
    'Vous utilisez Excel mais avez l''impression de perdre du temps sur des tâches simples ? '
    || 'Ce mini-parcours gratuit vous montre pourquoi Excel est une compétence recherchée, '
    || 'les raccourcis qui changent le quotidien et la bonne façon de structurer vos données.',
    'excel', 'debutant', 0, 0,
    $json$[
      {"title": "Découvrir la puissance d'Excel", "lessons": [
        {"title": "Pourquoi Excel peut booster votre carrière", "min": 8, "free": true,
         "summary": "Pourquoi Excel est une compétence essentielle dans presque tous les secteurs, et comment sa maîtrise te différencie sur le marché du travail.",
         "quiz": [
           {"prompt": "Un tableau croisé dynamique sert principalement à…",
            "choices": ["Résumer et analyser rapidement un grand volume de données", "Dessiner des schémas", "Envoyer des e-mails groupés"],
            "explanation": "Le TCD regroupe, additionne et compte des milliers de lignes en quelques clics."},
           {"prompt": "Quel est le premier bénéfice d'automatiser un calcul avec une formule ?",
            "choices": ["Le résultat se met à jour tout seul quand les données changent", "Le fichier devient plus léger", "Les cellules changent de couleur"],
            "explanation": "Une formule se recalcule automatiquement : fini les calculs refaits à la main."}
         ]},
        {"title": "Les raccourcis qui changent le quotidien", "min": 10, "free": true,
         "summary": "Les raccourcis clavier les plus utiles pour naviguer, sélectionner et saisir plus vite.",
         "quiz": [
           {"prompt": "Quel raccourci insère la date du jour dans une cellule ?",
            "choices": ["Ctrl + ;", "Ctrl + D", "Ctrl + J"],
            "explanation": "Ctrl + ; insère la date du jour sous forme de valeur fixe."},
           {"prompt": "Ctrl + flèche vers le bas permet de…",
            "choices": ["Aller à la dernière cellule remplie de la colonne", "Supprimer la ligne en dessous", "Insérer une ligne"],
            "explanation": "Ctrl + flèche saute jusqu'au bord de la zone de données : idéal dans les grands tableaux."}
         ]},
        {"title": "Structurer ses données proprement", "min": 10, "free": true,
         "summary": "La méthode pour organiser un tableau de données afin de pouvoir le trier, le filtrer et l'analyser sans effort.",
         "quiz": [
           {"prompt": "Dans un bon tableau de données, chaque colonne doit contenir…",
            "choices": ["Un seul type d'information, avec un en-tête", "Plusieurs informations séparées par des virgules", "Des cellules fusionnées pour la lisibilité"],
            "explanation": "Une colonne = une information. C'est la base pour trier, filtrer et faire des TCD."},
           {"prompt": "Pourquoi éviter les cellules fusionnées dans un tableau de données ?",
            "choices": ["Elles bloquent le tri, les filtres et les TCD", "Elles ralentissent l'impression", "Elles sont interdites dans Excel 365"],
            "explanation": "Les cellules fusionnées cassent la structure en lignes et colonnes dont Excel a besoin."}
         ]}
      ]}
    ]$json$::jsonb);

  -- ------------------------------------------------------------------
  perform pg_temp.dna_seed_course(v_admin,
    'excel-de-a-a-z',
    'Excel de A à Z : des bases à l''analyse',
    'Le parcours complet pour passer de débutant à utilisateur à l''aise : formules, tableaux croisés, graphiques et automatisation.',
    'Une formation complète qui inclut à la fois les bases essentielles et des formules avancées. '
    || 'Six modules progressifs, des cas concrets à refaire avec les fichiers d''exercice, '
    || 'et un quiz à chaque étape pour vérifier que c''est acquis. '
    || 'Bonus : la fiche PDF des raccourcis clavier Excel.',
    'excel', 'debutant', 7500, 49000,
    $json$[
      {"title": "Introduction et bases d'Excel", "lessons": [
        {"title": "Présentation de l'interface d'Excel", "free": true, "min": 8,
         "summary": "Découvrir les éléments de base : ruban, cellules, feuilles de calcul.",
         "quiz": [
           {"prompt": "Comment s'appelle la bande d'onglets en haut d'Excel qui regroupe les commandes ?",
            "choices": ["Le ruban", "La barre d'état", "Le volet de navigation"],
            "explanation": "Le ruban regroupe les commandes par onglets : Accueil, Insertion, Formules…"},
           {"prompt": "Comment s'appelle la cellule à l'intersection de la colonne C et de la ligne 5 ?",
            "choices": ["C5", "5C", "C:5"],
            "explanation": "On écrit toujours la lettre de colonne puis le numéro de ligne."}
         ]},
        {"title": "Gestion des classeurs et feuilles", "min": 8,
         "summary": "Créer, enregistrer et organiser des feuilles et des classeurs.",
         "quiz": [
           {"prompt": "Quelle est l'extension d'un classeur Excel standard sans macros ?",
            "choices": [".xlsx", ".xlsm", ".csv"],
            "explanation": ".xlsx est le format standard ; .xlsm contient des macros ; .csv est un simple texte."},
           {"prompt": "Un classeur Excel peut contenir…",
            "choices": ["Une ou plusieurs feuilles", "Une seule feuille", "Uniquement des graphiques"],
            "explanation": "Un classeur regroupe autant de feuilles que nécessaire."}
         ]},
        {"title": "Saisie et formatage des données", "min": 10,
         "summary": "Saisie rapide et formats de cellules : nombres, texte, dates, pourcentages.",
         "quiz": [
           {"prompt": "Une date correctement saisie est stockée par Excel sous forme…",
            "choices": ["De nombre", "De texte", "D'image"],
            "explanation": "Excel stocke les dates comme des nombres : c'est ce qui permet de calculer des écarts entre dates."},
           {"prompt": "Pour afficher 0,25 sous la forme 25 %, on…",
            "choices": ["Applique le format Pourcentage", "Tape 25 puis le symbole % dans une autre cellule", "Multiplie la cellule par 100 à la main"],
            "explanation": "Le format change l'affichage sans modifier la valeur stockée (0,25)."}
         ]},
        {"title": "Navigation et raccourcis clavier essentiels", "min": 8,
         "summary": "Accélérer son travail grâce aux raccourcis indispensables.",
         "quiz": [
           {"prompt": "Quel raccourci annule la dernière action ?",
            "choices": ["Ctrl + Z", "Ctrl + Y", "Ctrl + X"],
            "explanation": "Ctrl + Z annule, Ctrl + Y rétablit, Ctrl + X coupe."},
           {"prompt": "Quel raccourci recopie vers le bas le contenu de la cellule du dessus ?",
            "choices": ["Ctrl + D", "Ctrl + B", "Ctrl + H"],
            "explanation": "Ctrl + D recopie la cellule du dessus dans la sélection."}
         ]},
        {"title": "Création de tableaux simples", "min": 10,
         "summary": "Mise en forme automatique et alignements pour des tableaux lisibles.",
         "quiz": [
           {"prompt": "Quel est l'avantage de « Mettre sous forme de tableau » ?",
            "choices": ["Les formules et filtres s'étendent automatiquement aux nouvelles lignes", "Le fichier est protégé par mot de passe", "Les données sont envoyées sur OneDrive"],
            "explanation": "Un tableau structuré s'agrandit tout seul et garde formules, filtres et mise en forme."}
         ]}
      ]},
      {"title": "Formules et fonctions de base", "lessons": [
        {"title": "Introduction aux formules", "min": 10,
         "summary": "Utiliser des formules simples : addition, soustraction, multiplication, division.",
         "quiz": [
           {"prompt": "Par quel caractère commence toute formule Excel ?",
            "choices": ["=", "#", "@"],
            "explanation": "Le signe = indique à Excel qu'il doit calculer."},
           {"prompt": "Que renvoie la formule =SOMME(2;3)*2 ?",
            "choices": ["10", "8", "7"],
            "explanation": "SOMME(2;3) vaut 5, multiplié par 2 : 10."}
         ]},
        {"title": "Les fonctions mathématiques essentielles", "min": 12,
         "summary": "SOMME, MOYENNE, MIN, MAX et leurs applications concrètes.",
         "quiz": [
           {"prompt": "Quelle fonction renvoie la plus petite valeur d'une plage ?",
            "choices": ["MIN", "MOYENNE", "MAX"],
            "explanation": "MIN renvoie la plus petite valeur, MAX la plus grande."},
           {"prompt": "Que renvoie =MOYENNE(4;6;8) ?",
            "choices": ["6", "18", "4"],
            "explanation": "(4 + 6 + 8) / 3 = 6."}
         ]},
        {"title": "Les références absolues et relatives", "min": 12,
         "summary": "Comprendre et utiliser les références avec $ dans les formules.",
         "quiz": [
           {"prompt": "Vous recopiez =A1*$B$1 une ligne plus bas. Qu'obtenez-vous ?",
            "choices": ["=A2*$B$1", "=A2*$B$2", "=A1*$B$1"],
            "explanation": "A1 est relative et devient A2 ; $B$1 est absolue et reste fixe."},
           {"prompt": "Quelle touche ajoute les $ dans une référence pendant la saisie (Windows) ?",
            "choices": ["F4", "F2", "F9"],
            "explanation": "F4 fait défiler $A$1, A$1, $A1 puis A1."}
         ]},
        {"title": "Utilisation de la fonction SI", "min": 12,
         "summary": "La fonction SI pour les tests logiques de base.",
         "quiz": [
           {"prompt": "Avec A1 = 10, que renvoie =SI(A1>=10;\"Admis\";\"Recalé\") ?",
            "choices": ["Admis", "Recalé", "#VALEUR!"],
            "explanation": "10 >= 10 est vrai : SI renvoie le deuxième argument."},
           {"prompt": "Combien d'arguments la fonction SI attend-elle au maximum ?",
            "choices": ["3", "2", "4"],
            "explanation": "Le test, la valeur si vrai, la valeur si faux."}
         ]},
        {"title": "Fonctions de texte", "min": 10,
         "summary": "Concaténer, découper et manipuler du texte dans Excel.",
         "quiz": [
           {"prompt": "Quelle formule renvoie les 3 premiers caractères de A1 ?",
            "choices": ["=GAUCHE(A1;3)", "=DROITE(A1;3)", "=NBCAR(A1;3)"],
            "explanation": "GAUCHE prend les caractères depuis le début du texte."},
           {"prompt": "Pour assembler le prénom (A1) et le nom (B1) avec un espace :",
            "choices": ["=A1&\" \"&B1", "=A1+\" \"+B1", "=SOMME(A1;B1)"],
            "explanation": "L'opérateur & colle des textes entre eux."}
         ]}
      ]},
      {"title": "Gestion des données et tri", "lessons": [
        {"title": "Tri et filtre des données", "min": 10,
         "summary": "Trier et filtrer efficacement les données d'un tableau.",
         "quiz": [
           {"prompt": "Quel raccourci active ou désactive les filtres automatiques ?",
            "choices": ["Ctrl + Maj + L", "Ctrl + Maj + F", "Ctrl + Alt + T"],
            "explanation": "Ctrl + Maj + L ajoute ou retire les flèches de filtre."}
         ]},
        {"title": "Validation des données", "min": 10,
         "summary": "Restreindre la saisie grâce aux listes déroulantes et aux règles.",
         "quiz": [
           {"prompt": "La validation des données permet…",
            "choices": ["De limiter ce que l'utilisateur peut saisir", "De vérifier l'orthographe", "De protéger le fichier par mot de passe"],
            "explanation": "Liste déroulante, nombre entre deux bornes, date valide… on contrôle la saisie."}
         ]},
        {"title": "Suppression des doublons", "min": 8,
         "summary": "Identifier et supprimer les doublons dans les données.",
         "quiz": [
           {"prompt": "Dans quel onglet se trouve la commande « Supprimer les doublons » ?",
            "choices": ["Données", "Accueil", "Révision"],
            "explanation": "Données > Outils de données > Supprimer les doublons."}
         ]},
        {"title": "Les tableaux croisés dynamiques (introduction)", "min": 15,
         "summary": "Créer des tableaux croisés dynamiques pour résumer les données.",
         "quiz": [
           {"prompt": "Dans un TCD, quelle zone sert à additionner ou compter les valeurs ?",
            "choices": ["Valeurs", "Lignes", "Filtres"],
            "explanation": "La zone Valeurs agrège les données ; Lignes et Colonnes les regroupent."},
           {"prompt": "Vos données sources changent. Que faut-il faire pour mettre à jour le TCD ?",
            "choices": ["Actualiser le TCD", "Recréer le TCD", "Rien, il se met à jour seul"],
            "explanation": "Un TCD ne se recalcule pas seul : clic droit > Actualiser."}
         ]},
        {"title": "Tri avancé et personnalisations", "min": 10,
         "summary": "Trier sur plusieurs colonnes et créer des tris personnalisés.",
         "quiz": [
           {"prompt": "Pour trier par ville puis par montant, on utilise…",
            "choices": ["Le tri personnalisé avec plusieurs niveaux", "Un filtre automatique", "Deux tris successifs sur la même colonne"],
            "explanation": "Données > Trier permet d'empiler plusieurs niveaux de tri."}
         ]}
      ]},
      {"title": "Graphiques et visualisation des données", "lessons": [
        {"title": "Création de graphiques de base", "min": 12,
         "summary": "Graphiques en barres, courbes, secteurs, et quand les utiliser.",
         "quiz": [
           {"prompt": "Pour montrer l'évolution des ventes mois par mois, le plus adapté est…",
            "choices": ["Un graphique en courbes", "Un graphique en secteurs", "Un nuage de points"],
            "explanation": "La courbe montre une tendance dans le temps."},
           {"prompt": "Un graphique en secteurs convient pour…",
            "choices": ["Montrer la répartition d'un total en quelques parts", "Comparer 24 mois de chiffre d'affaires", "Afficher une corrélation"],
            "explanation": "Les secteurs montrent des parts d'un tout, avec peu de catégories."}
         ]},
        {"title": "Personnalisation des graphiques", "min": 8,
         "summary": "Couleurs, légendes, titres et mise en forme pour un message clair."},
        {"title": "Création de graphiques dynamiques", "min": 12,
         "summary": "Des graphiques interactifs avec segments et filtres."},
        {"title": "Graphiques combinés", "min": 10,
         "summary": "Associer plusieurs types de graphiques dans un même visuel.",
         "quiz": [
           {"prompt": "Un axe secondaire est utile quand…",
            "choices": ["Deux séries ont des ordres de grandeur très différents", "On veut imprimer en noir et blanc", "Le graphique a trop de couleurs"],
            "explanation": "Exemple : chiffre d'affaires en milliers d'euros et taux de marge en %."}
         ]},
        {"title": "Utilisation des sparklines", "min": 6,
         "summary": "Insérer des mini-graphiques dans les cellules.",
         "quiz": [
           {"prompt": "Les sparklines sont…",
            "choices": ["Des mini-graphiques affichés dans une cellule", "Des effets de mise en forme conditionnelle", "Des raccourcis clavier"],
            "explanation": "Elles montrent une tendance d'un coup d'œil, directement dans le tableau."}
         ]}
      ]},
      {"title": "Analyse des données", "lessons": [
        {"title": "Tableaux croisés dynamiques avancés", "min": 15,
         "summary": "Analyse approfondie : regroupements, champs calculés, affichage en pourcentage."},
        {"title": "Les segments et chronologies", "min": 10,
         "summary": "Filtrer visuellement ses données avec les segments.",
         "quiz": [
           {"prompt": "Un segment permet de…",
            "choices": ["Filtrer un TCD en cliquant sur des boutons", "Découper une cellule en deux", "Séparer un texte en colonnes"],
            "explanation": "Les segments sont des filtres visuels, parfaits pour les tableaux de bord."}
         ]},
        {"title": "Les fonctions de recherche (RECHERCHEV, INDEX, EQUIV)", "min": 15,
         "summary": "Rechercher et extraire des données dans de grands ensembles.",
         "quiz": [
           {"prompt": "RECHERCHEV cherche la valeur demandée…",
            "choices": ["Dans la première colonne de la plage", "Dans la dernière colonne de la plage", "Dans toute la feuille"],
            "explanation": "C'est sa principale limite : la clé doit être dans la première colonne."},
           {"prompt": "Quel est l'avantage d'INDEX + EQUIV sur RECHERCHEV ?",
            "choices": ["Pouvoir chercher à gauche de la colonne de résultat", "Être plus court à écrire", "Fonctionner sans plage de données"],
            "explanation": "INDEX + EQUIV (ou RECHERCHEX) cherche dans n'importe quelle colonne."}
         ]},
        {"title": "Fonctions de base de données (BDLIRE, BDSOMME…)", "min": 10,
         "summary": "Utiliser les fonctions spécifiques aux bases de données.",
         "quiz": [
           {"prompt": "BDSOMME additionne…",
            "choices": ["Les valeurs d'une colonne qui respectent des critères", "Toutes les cellules d'une feuille", "Les valeurs de plusieurs classeurs fermés"],
            "explanation": "BDSOMME s'appuie sur une zone de critères, comme un filtre."}
         ]},
        {"title": "Analyse rapide des données", "min": 6,
         "summary": "Utiliser les outils automatiques d'Excel pour résumer les données."}
      ]},
      {"title": "Automatisation et macros", "lessons": [
        {"title": "Introduction aux macros", "min": 10,
         "summary": "Enregistrer et exécuter des macros simples pour automatiser les tâches.",
         "quiz": [
           {"prompt": "Sous quel format enregistrer un classeur qui contient des macros ?",
            "choices": [".xlsm", ".xlsx", ".pdf"],
            "explanation": "Le format .xlsx supprime les macros à l'enregistrement."},
           {"prompt": "Quel onglet regroupe les outils de macros et de VBA ?",
            "choices": ["Développeur", "Formules", "Révision"],
            "explanation": "Il faut parfois l'activer : Fichier > Options > Personnaliser le ruban."}
         ]},
        {"title": "Gestion des macros", "min": 8,
         "summary": "Modifier, copier et supprimer des macros."},
        {"title": "Création de boutons de macros", "min": 8,
         "summary": "Associer des macros à des boutons et à des raccourcis."},
        {"title": "Introduction au langage VBA", "min": 15,
         "summary": "Les bases du langage VBA pour créer des automatisations."},
        {"title": "Automatisation de tâches répétitives", "min": 15,
         "summary": "Automatiser les traitements fréquents avec des scripts simples."}
      ]}
    ]$json$::jsonb);
end $seed$;

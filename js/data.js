// Ball Knowledge - player/squad data
// 34 squads (team + decade) x 6 players = 204 records
// Stats are approximate per-game averages representative of the player's
// tenure with that franchise during that decade. Positions reflect real
// historical roles, including multi-position "tweener" players.

export const PLAYERS = [
  // --- Atlanta Hawks 1980s ---
  { name: "Dominique Wilkins", team: "Atlanta Hawks", decade: "1980s", pos: ["SF"], ppg: 26.0, rpg: 6.5, apg: 2.5, spg: 1.6, bpg: 0.8, tov: 2.8 },
  { name: "Kevin Willis", team: "Atlanta Hawks", decade: "1980s", pos: ["PF","C"], ppg: 12.5, rpg: 9.0, apg: 1.0, spg: 0.7, bpg: 0.9, tov: 1.8 },
  { name: "Tree Rollins", team: "Atlanta Hawks", decade: "1980s", pos: ["C"], ppg: 8.0, rpg: 7.5, apg: 1.5, spg: 0.8, bpg: 2.5, tov: 1.5 },
  { name: "Doc Rivers", team: "Atlanta Hawks", decade: "1980s", pos: ["PG"], ppg: 11.7, rpg: 3.2, apg: 6.9, spg: 1.9, bpg: 0.2, tov: 2.5 },
  { name: "Randy Wittman", team: "Atlanta Hawks", decade: "1980s", pos: ["SG","SF"], ppg: 9.5, rpg: 2.5, apg: 2.8, spg: 0.8, bpg: 0.2, tov: 1.5 },
  { name: "Spud Webb", team: "Atlanta Hawks", decade: "1980s", pos: ["PG"], ppg: 9.9, rpg: 2.3, apg: 5.4, spg: 1.2, bpg: 0.1, tov: 2.0 },

  // --- Boston Celtics 1980s ---
  { name: "Larry Bird", team: "Boston Celtics", decade: "1980s", pos: ["SF","PF"], ppg: 24.6, rpg: 10.1, apg: 6.3, spg: 1.8, bpg: 0.6, tov: 3.1 },
  { name: "Kevin McHale", team: "Boston Celtics", decade: "1980s", pos: ["PF","C"], ppg: 18.4, rpg: 7.3, apg: 1.7, spg: 0.6, bpg: 1.7, tov: 1.8 },
  { name: "Robert Parish", team: "Boston Celtics", decade: "1980s", pos: ["C"], ppg: 17.6, rpg: 9.1, apg: 1.5, spg: 0.6, bpg: 1.8, tov: 2.0 },
  { name: "Dennis Johnson", team: "Boston Celtics", decade: "1980s", pos: ["PG","SG"], ppg: 15.6, rpg: 3.5, apg: 5.5, spg: 1.1, bpg: 0.3, tov: 2.2 },
  { name: "Danny Ainge", team: "Boston Celtics", decade: "1980s", pos: ["SG","PG"], ppg: 13.5, rpg: 3.0, apg: 4.5, spg: 1.3, bpg: 0.2, tov: 2.0 },
  { name: "Cedric Maxwell", team: "Boston Celtics", decade: "1980s", pos: ["SF","PF"], ppg: 15.0, rpg: 6.0, apg: 2.5, spg: 0.8, bpg: 0.5, tov: 2.0 },

  // --- Brooklyn/New Jersey Nets 2000s ---
  { name: "Jason Kidd", team: "Brooklyn/New Jersey Nets", decade: "2000s", pos: ["PG"], ppg: 14.5, rpg: 6.8, apg: 8.9, spg: 1.9, bpg: 0.3, tov: 3.0 },
  { name: "Vince Carter", team: "Brooklyn/New Jersey Nets", decade: "2000s", pos: ["SG","SF"], ppg: 22.5, rpg: 5.0, apg: 4.0, spg: 1.2, bpg: 0.7, tov: 2.8 },
  { name: "Richard Jefferson", team: "Brooklyn/New Jersey Nets", decade: "2000s", pos: ["SF"], ppg: 16.5, rpg: 5.5, apg: 2.7, spg: 1.1, bpg: 0.4, tov: 2.1 },
  { name: "Kenyon Martin", team: "Brooklyn/New Jersey Nets", decade: "2000s", pos: ["PF"], ppg: 13.5, rpg: 7.5, apg: 1.5, spg: 0.9, bpg: 1.2, tov: 2.0 },
  { name: "Kerry Kittles", team: "Brooklyn/New Jersey Nets", decade: "2000s", pos: ["SG"], ppg: 12.5, rpg: 3.5, apg: 2.8, spg: 1.5, bpg: 0.3, tov: 1.7 },
  { name: "Jason Collins", team: "Brooklyn/New Jersey Nets", decade: "2000s", pos: ["C"], ppg: 4.5, rpg: 5.0, apg: 1.0, spg: 0.5, bpg: 0.7, tov: 1.0 },

  // --- Charlotte Hornets 1990s ---
  { name: "Larry Johnson", team: "Charlotte Hornets", decade: "1990s", pos: ["PF"], ppg: 19.0, rpg: 9.0, apg: 3.5, spg: 1.0, bpg: 0.4, tov: 2.8 },
  { name: "Alonzo Mourning", team: "Charlotte Hornets", decade: "1990s", pos: ["C"], ppg: 21.0, rpg: 10.0, apg: 1.4, spg: 0.7, bpg: 2.9, tov: 2.7 },
  { name: "Muggsy Bogues", team: "Charlotte Hornets", decade: "1990s", pos: ["PG"], ppg: 8.5, rpg: 2.5, apg: 8.5, spg: 1.8, bpg: 0.1, tov: 2.2 },
  { name: "Dell Curry", team: "Charlotte Hornets", decade: "1990s", pos: ["SG"], ppg: 15.0, rpg: 2.5, apg: 2.5, spg: 1.0, bpg: 0.2, tov: 1.5 },
  { name: "Glen Rice", team: "Charlotte Hornets", decade: "1990s", pos: ["SF","SG"], ppg: 17.0, rpg: 4.5, apg: 2.0, spg: 0.8, bpg: 0.3, tov: 1.8 },
  { name: "Kendall Gill", team: "Charlotte Hornets", decade: "1990s", pos: ["SG","SF"], ppg: 15.0, rpg: 4.0, apg: 3.0, spg: 1.7, bpg: 0.3, tov: 2.0 },

  // --- Chicago Bulls 1990s ---
  { name: "Michael Jordan", team: "Chicago Bulls", decade: "1990s", pos: ["SG"], ppg: 31.5, rpg: 6.0, apg: 5.3, spg: 2.3, bpg: 0.8, tov: 2.7 },
  { name: "Scottie Pippen", team: "Chicago Bulls", decade: "1990s", pos: ["SF","SG"], ppg: 19.5, rpg: 7.0, apg: 5.8, spg: 2.0, bpg: 0.9, tov: 2.7 },
  { name: "Dennis Rodman", team: "Chicago Bulls", decade: "1990s", pos: ["PF","C"], ppg: 5.5, rpg: 15.0, apg: 2.0, spg: 0.6, bpg: 0.3, tov: 1.2 },
  { name: "Horace Grant", team: "Chicago Bulls", decade: "1990s", pos: ["PF","C"], ppg: 13.0, rpg: 9.5, apg: 2.5, spg: 1.1, bpg: 0.9, tov: 1.9 },
  { name: "B.J. Armstrong", team: "Chicago Bulls", decade: "1990s", pos: ["PG"], ppg: 12.0, rpg: 2.0, apg: 4.5, spg: 1.0, bpg: 0.1, tov: 1.7 },
  { name: "Toni Kukoc", team: "Chicago Bulls", decade: "1990s", pos: ["SF","PF"], ppg: 13.0, rpg: 4.5, apg: 4.0, spg: 1.0, bpg: 0.4, tov: 2.3 },

  // --- Cleveland Cavaliers 2010s ---
  { name: "LeBron James", team: "Cleveland Cavaliers", decade: "2010s", pos: ["SF","PF"], ppg: 26.5, rpg: 7.5, apg: 7.5, spg: 1.5, bpg: 0.7, tov: 3.8 },
  { name: "Kyrie Irving", team: "Cleveland Cavaliers", decade: "2010s", pos: ["PG"], ppg: 22.5, rpg: 3.5, apg: 5.8, spg: 1.3, bpg: 0.3, tov: 2.6 },
  { name: "Kevin Love", team: "Cleveland Cavaliers", decade: "2010s", pos: ["PF","C"], ppg: 17.5, rpg: 10.5, apg: 2.0, spg: 0.7, bpg: 0.4, tov: 1.8 },
  { name: "Tristan Thompson", team: "Cleveland Cavaliers", decade: "2010s", pos: ["C","PF"], ppg: 8.5, rpg: 9.0, apg: 1.0, spg: 0.6, bpg: 0.5, tov: 1.2 },
  { name: "J.R. Smith", team: "Cleveland Cavaliers", decade: "2010s", pos: ["SG","SF"], ppg: 10.5, rpg: 3.0, apg: 2.0, spg: 1.0, bpg: 0.3, tov: 1.3 },
  { name: "Mo Williams", team: "Cleveland Cavaliers", decade: "2010s", pos: ["PG"], ppg: 15.0, rpg: 2.5, apg: 6.0, spg: 0.9, bpg: 0.1, tov: 2.5 },

  // --- Dallas Mavericks 2000s ---
  { name: "Dirk Nowitzki", team: "Dallas Mavericks", decade: "2000s", pos: ["PF","C"], ppg: 23.5, rpg: 8.5, apg: 2.5, spg: 0.9, bpg: 0.8, tov: 2.5 },
  { name: "Steve Nash", team: "Dallas Mavericks", decade: "2000s", pos: ["PG"], ppg: 15.5, rpg: 3.0, apg: 8.5, spg: 0.9, bpg: 0.1, tov: 3.0 },
  { name: "Michael Finley", team: "Dallas Mavericks", decade: "2000s", pos: ["SG","SF"], ppg: 20.0, rpg: 4.5, apg: 4.0, spg: 1.3, bpg: 0.3, tov: 2.5 },
  { name: "Josh Howard", team: "Dallas Mavericks", decade: "2000s", pos: ["SF"], ppg: 15.0, rpg: 6.5, apg: 2.0, spg: 1.2, bpg: 0.6, tov: 1.8 },
  { name: "Jason Terry", team: "Dallas Mavericks", decade: "2000s", pos: ["SG","PG"], ppg: 16.5, rpg: 2.7, apg: 4.0, spg: 1.1, bpg: 0.2, tov: 2.3 },
  { name: "Erick Dampier", team: "Dallas Mavericks", decade: "2000s", pos: ["C"], ppg: 7.5, rpg: 8.5, apg: 0.8, spg: 0.5, bpg: 1.2, tov: 1.2 },

  // --- Denver Nuggets 1980s ---
  { name: "Alex English", team: "Denver Nuggets", decade: "1980s", pos: ["SF","SG"], ppg: 25.5, rpg: 5.5, apg: 3.5, spg: 1.1, bpg: 0.3, tov: 2.5 },
  { name: "Kiki Vandeweghe", team: "Denver Nuggets", decade: "1980s", pos: ["SF"], ppg: 22.0, rpg: 4.5, apg: 2.0, spg: 0.8, bpg: 0.3, tov: 2.0 },
  { name: "Dan Issel", team: "Denver Nuggets", decade: "1980s", pos: ["C","PF"], ppg: 20.0, rpg: 8.0, apg: 2.0, spg: 0.7, bpg: 0.5, tov: 2.2 },
  { name: "Fat Lever", team: "Denver Nuggets", decade: "1980s", pos: ["PG","SG"], ppg: 15.0, rpg: 6.5, apg: 7.0, spg: 2.2, bpg: 0.3, tov: 3.0 },
  { name: "Calvin Natt", team: "Denver Nuggets", decade: "1980s", pos: ["PF","SF"], ppg: 17.5, rpg: 7.5, apg: 2.0, spg: 1.0, bpg: 0.3, tov: 2.2 },
  { name: "Wayne Cooper", team: "Denver Nuggets", decade: "1980s", pos: ["C"], ppg: 8.0, rpg: 6.5, apg: 1.0, spg: 0.6, bpg: 1.5, tov: 1.5 },

  // --- Detroit Pistons 1980s ---
  { name: "Isiah Thomas", team: "Detroit Pistons", decade: "1980s", pos: ["PG"], ppg: 20.0, rpg: 3.5, apg: 9.5, spg: 2.0, bpg: 0.2, tov: 3.5 },
  { name: "Joe Dumars", team: "Detroit Pistons", decade: "1980s", pos: ["SG"], ppg: 17.0, rpg: 2.5, apg: 4.5, spg: 1.0, bpg: 0.2, tov: 2.0 },
  { name: "Bill Laimbeer", team: "Detroit Pistons", decade: "1980s", pos: ["C","PF"], ppg: 13.5, rpg: 9.5, apg: 1.8, spg: 0.7, bpg: 0.5, tov: 2.0 },
  { name: "Dennis Rodman", team: "Detroit Pistons", decade: "1980s", pos: ["PF","C"], ppg: 8.5, rpg: 8.5, apg: 1.5, spg: 0.9, bpg: 0.6, tov: 1.3 },
  { name: "Vinnie Johnson", team: "Detroit Pistons", decade: "1980s", pos: ["SG","PG"], ppg: 12.5, rpg: 2.0, apg: 3.0, spg: 0.8, bpg: 0.2, tov: 1.5 },
  { name: "Adrian Dantley", team: "Detroit Pistons", decade: "1980s", pos: ["SF","PF"], ppg: 20.0, rpg: 5.5, apg: 2.5, spg: 0.9, bpg: 0.2, tov: 2.7 },

  // --- Golden State Warriors 2010s ---
  { name: "Stephen Curry", team: "Golden State Warriors", decade: "2010s", pos: ["PG"], ppg: 24.5, rpg: 4.5, apg: 7.5, spg: 1.6, bpg: 0.2, tov: 3.2 },
  { name: "Klay Thompson", team: "Golden State Warriors", decade: "2010s", pos: ["SG"], ppg: 20.5, rpg: 3.5, apg: 2.5, spg: 1.0, bpg: 0.5, tov: 1.9 },
  { name: "Draymond Green", team: "Golden State Warriors", decade: "2010s", pos: ["PF","C"], ppg: 9.5, rpg: 7.5, apg: 6.0, spg: 1.5, bpg: 1.2, tov: 2.8 },
  { name: "Kevin Durant", team: "Golden State Warriors", decade: "2010s", pos: ["SF","PF"], ppg: 26.5, rpg: 7.5, apg: 5.5, spg: 1.1, bpg: 1.3, tov: 3.0 },
  { name: "Andre Iguodala", team: "Golden State Warriors", decade: "2010s", pos: ["SF","SG"], ppg: 7.5, rpg: 4.0, apg: 3.5, spg: 1.1, bpg: 0.5, tov: 1.3 },
  { name: "Harrison Barnes", team: "Golden State Warriors", decade: "2010s", pos: ["SF","PF"], ppg: 10.5, rpg: 5.0, apg: 1.5, spg: 0.8, bpg: 0.4, tov: 1.3 },

  // --- Houston Rockets 1990s ---
  { name: "Hakeem Olajuwon", team: "Houston Rockets", decade: "1990s", pos: ["C"], ppg: 26.5, rpg: 11.5, apg: 3.5, spg: 1.8, bpg: 3.5, tov: 3.2 },
  { name: "Clyde Drexler", team: "Houston Rockets", decade: "1990s", pos: ["SG","SF"], ppg: 18.5, rpg: 5.5, apg: 5.5, spg: 1.6, bpg: 0.6, tov: 2.6 },
  { name: "Otis Thorpe", team: "Houston Rockets", decade: "1990s", pos: ["PF","C"], ppg: 14.5, rpg: 9.5, apg: 1.8, spg: 1.0, bpg: 0.8, tov: 2.0 },
  { name: "Kenny Smith", team: "Houston Rockets", decade: "1990s", pos: ["PG"], ppg: 12.5, rpg: 3.0, apg: 5.5, spg: 1.3, bpg: 0.2, tov: 2.3 },
  { name: "Vernon Maxwell", team: "Houston Rockets", decade: "1990s", pos: ["SG","PG"], ppg: 13.0, rpg: 3.0, apg: 3.5, spg: 1.3, bpg: 0.3, tov: 2.2 },
  { name: "Robert Horry", team: "Houston Rockets", decade: "1990s", pos: ["SF","PF"], ppg: 9.0, rpg: 5.5, apg: 2.5, spg: 1.2, bpg: 1.0, tov: 1.7 },

  // --- Indiana Pacers 1990s ---
  { name: "Reggie Miller", team: "Indiana Pacers", decade: "1990s", pos: ["SG"], ppg: 20.5, rpg: 3.0, apg: 3.0, spg: 1.1, bpg: 0.2, tov: 1.9 },
  { name: "Rik Smits", team: "Indiana Pacers", decade: "1990s", pos: ["C"], ppg: 16.0, rpg: 7.0, apg: 1.5, spg: 0.4, bpg: 1.2, tov: 1.8 },
  { name: "Dale Davis", team: "Indiana Pacers", decade: "1990s", pos: ["PF","C"], ppg: 10.5, rpg: 9.5, apg: 1.0, spg: 0.7, bpg: 1.0, tov: 1.5 },
  { name: "Mark Jackson", team: "Indiana Pacers", decade: "1990s", pos: ["PG"], ppg: 11.0, rpg: 4.5, apg: 8.5, spg: 1.5, bpg: 0.1, tov: 2.8 },
  { name: "Derrick McKey", team: "Indiana Pacers", decade: "1990s", pos: ["SF","PF"], ppg: 11.5, rpg: 5.5, apg: 3.0, spg: 1.3, bpg: 0.7, tov: 1.8 },
  { name: "Chris Mullin", team: "Indiana Pacers", decade: "1990s", pos: ["SF","SG"], ppg: 13.5, rpg: 3.5, apg: 3.0, spg: 1.0, bpg: 0.2, tov: 1.7 },

  // --- LA Clippers 2010s ---
  { name: "Chris Paul", team: "LA Clippers", decade: "2010s", pos: ["PG"], ppg: 18.5, rpg: 4.5, apg: 10.0, spg: 2.4, bpg: 0.1, tov: 2.5 },
  { name: "Blake Griffin", team: "LA Clippers", decade: "2010s", pos: ["PF"], ppg: 22.0, rpg: 9.5, apg: 3.5, spg: 0.9, bpg: 0.5, tov: 2.9 },
  { name: "DeAndre Jordan", team: "LA Clippers", decade: "2010s", pos: ["C"], ppg: 10.5, rpg: 13.5, apg: 1.0, spg: 0.6, bpg: 2.2, tov: 1.7 },
  { name: "J.J. Redick", team: "LA Clippers", decade: "2010s", pos: ["SG"], ppg: 15.5, rpg: 2.0, apg: 2.0, spg: 0.6, bpg: 0.2, tov: 1.5 },
  { name: "Jamal Crawford", team: "LA Clippers", decade: "2010s", pos: ["SG","PG"], ppg: 15.0, rpg: 2.5, apg: 3.5, spg: 0.9, bpg: 0.2, tov: 2.0 },
  { name: "Matt Barnes", team: "LA Clippers", decade: "2010s", pos: ["SF","PF"], ppg: 9.5, rpg: 5.0, apg: 2.0, spg: 1.2, bpg: 0.4, tov: 1.3 },

  // --- LA Lakers 1980s ---
  { name: "Magic Johnson", team: "LA Lakers", decade: "1980s", pos: ["PG"], ppg: 19.5, rpg: 7.5, apg: 11.5, spg: 1.7, bpg: 0.4, tov: 3.7 },
  { name: "Kareem Abdul-Jabbar", team: "LA Lakers", decade: "1980s", pos: ["C"], ppg: 23.5, rpg: 9.5, apg: 3.0, spg: 0.8, bpg: 2.5, tov: 2.8 },
  { name: "James Worthy", team: "LA Lakers", decade: "1980s", pos: ["SF","PF"], ppg: 17.5, rpg: 5.5, apg: 3.0, spg: 1.1, bpg: 0.6, tov: 2.3 },
  { name: "Byron Scott", team: "LA Lakers", decade: "1980s", pos: ["SG"], ppg: 15.5, rpg: 3.0, apg: 3.0, spg: 1.2, bpg: 0.2, tov: 1.8 },
  { name: "Michael Cooper", team: "LA Lakers", decade: "1980s", pos: ["SG","SF"], ppg: 10.5, rpg: 3.5, apg: 3.5, spg: 1.5, bpg: 0.6, tov: 1.8 },
  { name: "Jamaal Wilkes", team: "LA Lakers", decade: "1980s", pos: ["SF","PF"], ppg: 15.0, rpg: 6.0, apg: 2.5, spg: 1.0, bpg: 0.5, tov: 1.8 },

  // --- Memphis Grizzlies 2010s ---
  { name: "Mike Conley", team: "Memphis Grizzlies", decade: "2010s", pos: ["PG"], ppg: 15.5, rpg: 3.0, apg: 5.8, spg: 1.4, bpg: 0.2, tov: 2.2 },
  { name: "Marc Gasol", team: "Memphis Grizzlies", decade: "2010s", pos: ["C"], ppg: 16.5, rpg: 7.8, apg: 3.5, spg: 1.0, bpg: 1.3, tov: 2.3 },
  { name: "Zach Randolph", team: "Memphis Grizzlies", decade: "2010s", pos: ["PF"], ppg: 17.5, rpg: 10.5, apg: 2.0, spg: 0.6, bpg: 0.3, tov: 2.2 },
  { name: "Tony Allen", team: "Memphis Grizzlies", decade: "2010s", pos: ["SG","SF"], ppg: 8.5, rpg: 3.5, apg: 1.5, spg: 1.7, bpg: 0.4, tov: 1.3 },
  { name: "Rudy Gay", team: "Memphis Grizzlies", decade: "2010s", pos: ["SF","SG"], ppg: 18.5, rpg: 5.5, apg: 2.5, spg: 1.3, bpg: 0.9, tov: 2.5 },
  { name: "O.J. Mayo", team: "Memphis Grizzlies", decade: "2010s", pos: ["SG"], ppg: 17.5, rpg: 3.5, apg: 3.5, spg: 1.1, bpg: 0.2, tov: 2.3 },

  // --- Miami Heat 2010s ---
  { name: "LeBron James", team: "Miami Heat", decade: "2010s", pos: ["SF","PF"], ppg: 27.0, rpg: 7.5, apg: 6.8, spg: 1.7, bpg: 0.8, tov: 3.4 },
  { name: "Dwyane Wade", team: "Miami Heat", decade: "2010s", pos: ["SG","PG"], ppg: 22.0, rpg: 4.5, apg: 5.0, spg: 1.7, bpg: 1.0, tov: 3.2 },
  { name: "Chris Bosh", team: "Miami Heat", decade: "2010s", pos: ["PF","C"], ppg: 17.5, rpg: 7.5, apg: 2.0, spg: 0.7, bpg: 1.0, tov: 2.0 },
  { name: "Hassan Whiteside", team: "Miami Heat", decade: "2010s", pos: ["C"], ppg: 14.0, rpg: 11.5, apg: 0.5, spg: 0.5, bpg: 2.5, tov: 1.8 },
  { name: "Goran Dragic", team: "Miami Heat", decade: "2010s", pos: ["PG"], ppg: 14.5, rpg: 3.0, apg: 4.5, spg: 1.0, bpg: 0.2, tov: 2.2 },
  { name: "Udonis Haslem", team: "Miami Heat", decade: "2010s", pos: ["PF"], ppg: 6.5, rpg: 6.5, apg: 0.8, spg: 0.5, bpg: 0.3, tov: 0.8 },

  // --- Milwaukee Bucks 1970s ---
  { name: "Kareem Abdul-Jabbar", team: "Milwaukee Bucks", decade: "1970s", pos: ["C"], ppg: 30.0, rpg: 15.0, apg: 4.5, spg: 1.0, bpg: 3.0, tov: 3.0 },
  { name: "Oscar Robertson", team: "Milwaukee Bucks", decade: "1970s", pos: ["PG"], ppg: 17.5, rpg: 6.5, apg: 8.5, spg: 1.5, bpg: 0.2, tov: 3.5 },
  { name: "Bob Dandridge", team: "Milwaukee Bucks", decade: "1970s", pos: ["SF","PF"], ppg: 18.5, rpg: 6.5, apg: 3.0, spg: 1.3, bpg: 0.5, tov: 2.3 },
  { name: "Jon McGlocklin", team: "Milwaukee Bucks", decade: "1970s", pos: ["SG"], ppg: 15.5, rpg: 3.0, apg: 3.0, spg: 1.0, bpg: 0.2, tov: 1.8 },
  { name: "Lucius Allen", team: "Milwaukee Bucks", decade: "1970s", pos: ["PG","SG"], ppg: 13.5, rpg: 3.5, apg: 4.5, spg: 1.5, bpg: 0.2, tov: 2.5 },
  { name: "Marques Johnson", team: "Milwaukee Bucks", decade: "1970s", pos: ["SF","PF"], ppg: 19.5, rpg: 6.0, apg: 3.0, spg: 1.2, bpg: 0.5, tov: 2.3 },

  // --- Minnesota Timberwolves 2000s ---
  { name: "Kevin Garnett", team: "Minnesota Timberwolves", decade: "2000s", pos: ["PF","C"], ppg: 22.0, rpg: 12.5, apg: 4.5, spg: 1.4, bpg: 1.5, tov: 2.7 },
  { name: "Sam Cassell", team: "Minnesota Timberwolves", decade: "2000s", pos: ["PG"], ppg: 15.5, rpg: 2.5, apg: 6.5, spg: 1.0, bpg: 0.1, tov: 2.3 },
  { name: "Latrell Sprewell", team: "Minnesota Timberwolves", decade: "2000s", pos: ["SG","SF"], ppg: 16.5, rpg: 3.5, apg: 3.0, spg: 1.3, bpg: 0.4, tov: 2.3 },
  { name: "Wally Szczerbiak", team: "Minnesota Timberwolves", decade: "2000s", pos: ["SF","SG"], ppg: 16.0, rpg: 4.0, apg: 2.0, spg: 0.7, bpg: 0.3, tov: 1.8 },
  { name: "Rasho Nesterovic", team: "Minnesota Timberwolves", decade: "2000s", pos: ["C"], ppg: 9.5, rpg: 6.5, apg: 1.5, spg: 0.5, bpg: 1.2, tov: 1.5 },
  { name: "Terrell Brandon", team: "Minnesota Timberwolves", decade: "2000s", pos: ["PG"], ppg: 12.0, rpg: 3.0, apg: 6.5, spg: 1.3, bpg: 0.1, tov: 2.2 },

  // --- New Orleans Hornets/Pelicans 2000s ---
  { name: "Chris Paul", team: "New Orleans Hornets/Pelicans", decade: "2000s", pos: ["PG"], ppg: 18.5, rpg: 4.5, apg: 10.5, spg: 2.7, bpg: 0.1, tov: 2.8 },
  { name: "David West", team: "New Orleans Hornets/Pelicans", decade: "2000s", pos: ["PF"], ppg: 18.5, rpg: 8.0, apg: 2.0, spg: 0.9, bpg: 0.6, tov: 1.9 },
  { name: "Baron Davis", team: "New Orleans Hornets/Pelicans", decade: "2000s", pos: ["PG","SG"], ppg: 20.5, rpg: 3.0, apg: 7.5, spg: 2.2, bpg: 0.2, tov: 3.3 },
  { name: "Jamal Mashburn", team: "New Orleans Hornets/Pelicans", decade: "2000s", pos: ["SF","PF"], ppg: 19.5, rpg: 5.5, apg: 4.5, spg: 1.1, bpg: 0.3, tov: 2.8 },
  { name: "Peja Stojakovic", team: "New Orleans Hornets/Pelicans", decade: "2000s", pos: ["SF","SG"], ppg: 17.5, rpg: 4.5, apg: 1.5, spg: 0.7, bpg: 0.2, tov: 1.8 },
  { name: "Tyson Chandler", team: "New Orleans Hornets/Pelicans", decade: "2000s", pos: ["C"], ppg: 9.5, rpg: 10.5, apg: 1.0, spg: 0.7, bpg: 1.2, tov: 1.8 },

  // --- New York Knicks 1990s ---
  { name: "Patrick Ewing", team: "New York Knicks", decade: "1990s", pos: ["C"], ppg: 23.5, rpg: 10.5, apg: 2.2, spg: 1.0, bpg: 2.7, tov: 2.8 },
  { name: "John Starks", team: "New York Knicks", decade: "1990s", pos: ["SG","PG"], ppg: 15.5, rpg: 3.0, apg: 4.0, spg: 1.5, bpg: 0.2, tov: 2.5 },
  { name: "Charles Oakley", team: "New York Knicks", decade: "1990s", pos: ["PF"], ppg: 10.5, rpg: 9.5, apg: 2.0, spg: 1.0, bpg: 0.3, tov: 1.8 },
  { name: "Charlie Ward", team: "New York Knicks", decade: "1990s", pos: ["PG"], ppg: 6.5, rpg: 2.5, apg: 5.0, spg: 1.0, bpg: 0.1, tov: 1.5 },
  { name: "Allan Houston", team: "New York Knicks", decade: "1990s", pos: ["SG"], ppg: 17.5, rpg: 3.0, apg: 2.5, spg: 0.8, bpg: 0.2, tov: 1.8 },
  { name: "Larry Johnson", team: "New York Knicks", decade: "1990s", pos: ["PF","SF"], ppg: 10.5, rpg: 5.5, apg: 2.5, spg: 0.8, bpg: 0.3, tov: 1.8 },

  // --- Oklahoma City Thunder 2010s ---
  { name: "Kevin Durant", team: "Oklahoma City Thunder", decade: "2010s", pos: ["SF","PF"], ppg: 28.0, rpg: 7.0, apg: 4.5, spg: 1.2, bpg: 1.0, tov: 3.0 },
  { name: "Russell Westbrook", team: "Oklahoma City Thunder", decade: "2010s", pos: ["PG"], ppg: 24.0, rpg: 7.0, apg: 8.5, spg: 1.7, bpg: 0.3, tov: 4.0 },
  { name: "James Harden", team: "Oklahoma City Thunder", decade: "2010s", pos: ["SG"], ppg: 16.5, rpg: 4.0, apg: 3.5, spg: 1.6, bpg: 0.4, tov: 2.4 },
  { name: "Serge Ibaka", team: "Oklahoma City Thunder", decade: "2010s", pos: ["PF","C"], ppg: 12.5, rpg: 7.5, apg: 1.0, spg: 0.7, bpg: 2.5, tov: 1.3 },
  { name: "Paul George", team: "Oklahoma City Thunder", decade: "2010s", pos: ["SF","SG"], ppg: 21.5, rpg: 6.0, apg: 3.5, spg: 1.8, bpg: 0.4, tov: 2.9 },
  { name: "Nick Collison", team: "Oklahoma City Thunder", decade: "2010s", pos: ["PF","C"], ppg: 5.0, rpg: 5.0, apg: 1.0, spg: 0.5, bpg: 0.4, tov: 0.8 },

  // --- Orlando Magic 1990s ---
  { name: "Shaquille O'Neal", team: "Orlando Magic", decade: "1990s", pos: ["C"], ppg: 27.5, rpg: 12.0, apg: 2.8, spg: 0.7, bpg: 2.5, tov: 3.3 },
  { name: "Penny Hardaway", team: "Orlando Magic", decade: "1990s", pos: ["PG","SG"], ppg: 20.5, rpg: 4.5, apg: 6.5, spg: 1.7, bpg: 0.3, tov: 3.0 },
  { name: "Nick Anderson", team: "Orlando Magic", decade: "1990s", pos: ["SG","SF"], ppg: 15.5, rpg: 4.5, apg: 3.0, spg: 1.5, bpg: 0.4, tov: 2.0 },
  { name: "Dennis Scott", team: "Orlando Magic", decade: "1990s", pos: ["SF","SG"], ppg: 12.5, rpg: 3.0, apg: 2.5, spg: 0.9, bpg: 0.2, tov: 1.7 },
  { name: "Horace Grant", team: "Orlando Magic", decade: "1990s", pos: ["PF"], ppg: 13.5, rpg: 8.5, apg: 2.5, spg: 1.1, bpg: 0.8, tov: 1.9 },
  { name: "Darrell Armstrong", team: "Orlando Magic", decade: "1990s", pos: ["PG"], ppg: 10.0, rpg: 2.5, apg: 5.0, spg: 1.5, bpg: 0.1, tov: 1.8 },

  // --- Philadelphia 76ers 1980s ---
  { name: "Julius Erving", team: "Philadelphia 76ers", decade: "1980s", pos: ["SF"], ppg: 22.0, rpg: 6.5, apg: 3.8, spg: 1.5, bpg: 1.4, tov: 2.8 },
  { name: "Moses Malone", team: "Philadelphia 76ers", decade: "1980s", pos: ["C","PF"], ppg: 24.5, rpg: 12.5, apg: 1.5, spg: 0.9, bpg: 1.3, tov: 2.7 },
  { name: "Maurice Cheeks", team: "Philadelphia 76ers", decade: "1980s", pos: ["PG"], ppg: 12.5, rpg: 3.0, apg: 7.0, spg: 2.2, bpg: 0.2, tov: 2.3 },
  { name: "Andrew Toney", team: "Philadelphia 76ers", decade: "1980s", pos: ["SG"], ppg: 17.0, rpg: 3.0, apg: 4.5, spg: 1.1, bpg: 0.2, tov: 2.2 },
  { name: "Bobby Jones", team: "Philadelphia 76ers", decade: "1980s", pos: ["SF","PF"], ppg: 10.5, rpg: 5.0, apg: 2.5, spg: 1.3, bpg: 1.2, tov: 1.5 },
  { name: "Charles Barkley", team: "Philadelphia 76ers", decade: "1980s", pos: ["PF","SF"], ppg: 20.0, rpg: 11.5, apg: 3.5, spg: 1.6, bpg: 0.7, tov: 3.0 },

  // --- Phoenix Suns 2000s ---
  { name: "Steve Nash", team: "Phoenix Suns", decade: "2000s", pos: ["PG"], ppg: 16.5, rpg: 3.5, apg: 10.5, spg: 0.7, bpg: 0.1, tov: 3.3 },
  { name: "Amar'e Stoudemire", team: "Phoenix Suns", decade: "2000s", pos: ["PF","C"], ppg: 21.5, rpg: 8.5, apg: 1.5, spg: 0.7, bpg: 1.5, tov: 2.7 },
  { name: "Shawn Marion", team: "Phoenix Suns", decade: "2000s", pos: ["SF","PF"], ppg: 18.5, rpg: 9.5, apg: 1.8, spg: 1.8, bpg: 1.2, tov: 2.1 },
  { name: "Joe Johnson", team: "Phoenix Suns", decade: "2000s", pos: ["SG","SF"], ppg: 17.0, rpg: 3.5, apg: 5.0, spg: 1.1, bpg: 0.3, tov: 2.5 },
  { name: "Raja Bell", team: "Phoenix Suns", decade: "2000s", pos: ["SG"], ppg: 11.5, rpg: 3.0, apg: 2.0, spg: 1.3, bpg: 0.2, tov: 1.3 },
  { name: "Boris Diaw", team: "Phoenix Suns", decade: "2000s", pos: ["PF","C"], ppg: 9.5, rpg: 4.5, apg: 4.0, spg: 0.8, bpg: 0.6, tov: 1.6 },

  // --- Portland Trail Blazers 1990s ---
  { name: "Clyde Drexler", team: "Portland Trail Blazers", decade: "1990s", pos: ["SG","SF"], ppg: 23.0, rpg: 6.5, apg: 5.8, spg: 2.0, bpg: 0.7, tov: 3.0 },
  { name: "Terry Porter", team: "Portland Trail Blazers", decade: "1990s", pos: ["PG"], ppg: 15.0, rpg: 3.5, apg: 7.0, spg: 1.3, bpg: 0.2, tov: 2.5 },
  { name: "Buck Williams", team: "Portland Trail Blazers", decade: "1990s", pos: ["PF","C"], ppg: 11.5, rpg: 9.5, apg: 1.5, spg: 0.8, bpg: 0.5, tov: 1.5 },
  { name: "Jerome Kersey", team: "Portland Trail Blazers", decade: "1990s", pos: ["SF","PF"], ppg: 13.5, rpg: 5.5, apg: 2.5, spg: 1.2, bpg: 0.6, tov: 1.8 },
  { name: "Kevin Duckworth", team: "Portland Trail Blazers", decade: "1990s", pos: ["C"], ppg: 12.5, rpg: 6.5, apg: 1.0, spg: 0.4, bpg: 0.9, tov: 1.7 },
  { name: "Rod Strickland", team: "Portland Trail Blazers", decade: "1990s", pos: ["PG"], ppg: 15.5, rpg: 4.0, apg: 8.5, spg: 1.7, bpg: 0.2, tov: 2.9 },

  // --- Sacramento Kings 2000s ---
  { name: "Chris Webber", team: "Sacramento Kings", decade: "2000s", pos: ["PF","C"], ppg: 22.5, rpg: 10.5, apg: 4.5, spg: 1.4, bpg: 1.4, tov: 3.2 },
  { name: "Mike Bibby", team: "Sacramento Kings", decade: "2000s", pos: ["PG"], ppg: 16.5, rpg: 2.8, apg: 6.5, spg: 1.1, bpg: 0.2, tov: 2.3 },
  { name: "Peja Stojakovic", team: "Sacramento Kings", decade: "2000s", pos: ["SF","SG"], ppg: 20.5, rpg: 5.0, apg: 2.0, spg: 1.0, bpg: 0.3, tov: 1.8 },
  { name: "Vlade Divac", team: "Sacramento Kings", decade: "2000s", pos: ["C"], ppg: 11.5, rpg: 8.5, apg: 3.5, spg: 1.1, bpg: 1.2, tov: 2.3 },
  { name: "Doug Christie", team: "Sacramento Kings", decade: "2000s", pos: ["SG","SF"], ppg: 13.0, rpg: 3.5, apg: 3.5, spg: 2.0, bpg: 0.4, tov: 1.7 },
  { name: "Bobby Jackson", team: "Sacramento Kings", decade: "2000s", pos: ["SG","PG"], ppg: 12.5, rpg: 2.5, apg: 3.0, spg: 1.1, bpg: 0.3, tov: 1.5 },

  // --- San Antonio Spurs 2000s ---
  { name: "Tim Duncan", team: "San Antonio Spurs", decade: "2000s", pos: ["PF","C"], ppg: 23.5, rpg: 11.5, apg: 3.2, spg: 0.7, bpg: 2.5, tov: 2.9 },
  { name: "Tony Parker", team: "San Antonio Spurs", decade: "2000s", pos: ["PG"], ppg: 16.5, rpg: 2.8, apg: 5.5, spg: 0.9, bpg: 0.1, tov: 2.3 },
  { name: "Manu Ginobili", team: "San Antonio Spurs", decade: "2000s", pos: ["SG","SF"], ppg: 15.5, rpg: 3.8, apg: 4.0, spg: 1.5, bpg: 0.3, tov: 2.4 },
  { name: "David Robinson", team: "San Antonio Spurs", decade: "2000s", pos: ["C"], ppg: 14.5, rpg: 9.5, apg: 1.8, spg: 1.1, bpg: 2.3, tov: 2.0 },
  { name: "Bruce Bowen", team: "San Antonio Spurs", decade: "2000s", pos: ["SF","SG"], ppg: 6.5, rpg: 3.0, apg: 1.3, spg: 1.0, bpg: 0.3, tov: 0.8 },
  { name: "Malik Rose", team: "San Antonio Spurs", decade: "2000s", pos: ["PF","C"], ppg: 8.5, rpg: 6.0, apg: 1.0, spg: 0.6, bpg: 0.5, tov: 1.2 },

  // --- Toronto Raptors 2010s ---
  { name: "DeMar DeRozan", team: "Toronto Raptors", decade: "2010s", pos: ["SG","SF"], ppg: 21.5, rpg: 4.0, apg: 3.5, spg: 1.0, bpg: 0.3, tov: 2.2 },
  { name: "Kyle Lowry", team: "Toronto Raptors", decade: "2010s", pos: ["PG"], ppg: 17.5, rpg: 4.5, apg: 6.8, spg: 1.4, bpg: 0.2, tov: 2.6 },
  { name: "Amir Johnson", team: "Toronto Raptors", decade: "2010s", pos: ["PF","C"], ppg: 9.0, rpg: 6.5, apg: 1.2, spg: 0.7, bpg: 1.0, tov: 1.3 },
  { name: "Jonas Valanciunas", team: "Toronto Raptors", decade: "2010s", pos: ["C"], ppg: 12.5, rpg: 9.0, apg: 1.0, spg: 0.5, bpg: 1.0, tov: 1.6 },
  { name: "Kawhi Leonard", team: "Toronto Raptors", decade: "2010s", pos: ["SF","PF"], ppg: 26.5, rpg: 7.5, apg: 3.5, spg: 1.8, bpg: 0.4, tov: 2.0 },
  { name: "DeMarre Carroll", team: "Toronto Raptors", decade: "2010s", pos: ["SF"], ppg: 9.5, rpg: 4.5, apg: 1.5, spg: 1.0, bpg: 0.4, tov: 1.2 },

  // --- Utah Jazz 1990s ---
  { name: "John Stockton", team: "Utah Jazz", decade: "1990s", pos: ["PG"], ppg: 15.5, rpg: 2.7, apg: 11.5, spg: 2.4, bpg: 0.2, tov: 2.9 },
  { name: "Karl Malone", team: "Utah Jazz", decade: "1990s", pos: ["PF"], ppg: 27.5, rpg: 10.5, apg: 3.5, spg: 1.4, bpg: 0.8, tov: 2.9 },
  { name: "Jeff Hornacek", team: "Utah Jazz", decade: "1990s", pos: ["SG"], ppg: 15.0, rpg: 3.5, apg: 4.5, spg: 1.2, bpg: 0.2, tov: 1.8 },
  { name: "Thurl Bailey", team: "Utah Jazz", decade: "1990s", pos: ["PF","SF"], ppg: 13.5, rpg: 5.5, apg: 1.5, spg: 0.6, bpg: 0.7, tov: 1.5 },
  { name: "Antoine Carr", team: "Utah Jazz", decade: "1990s", pos: ["PF","C"], ppg: 10.5, rpg: 4.0, apg: 1.0, spg: 0.5, bpg: 0.6, tov: 1.2 },
  { name: "Bryon Russell", team: "Utah Jazz", decade: "1990s", pos: ["SF","SG"], ppg: 9.5, rpg: 3.5, apg: 1.5, spg: 1.0, bpg: 0.3, tov: 1.2 },

  // --- Washington Bullets 1970s ---
  { name: "Wes Unseld", team: "Washington Bullets", decade: "1970s", pos: ["C"], ppg: 10.5, rpg: 14.0, apg: 3.5, spg: 1.0, bpg: 0.5, tov: 2.5 },
  { name: "Elvin Hayes", team: "Washington Bullets", decade: "1970s", pos: ["PF","C"], ppg: 21.5, rpg: 12.5, apg: 2.0, spg: 1.0, bpg: 1.5, tov: 2.7 },
  { name: "Phil Chenier", team: "Washington Bullets", decade: "1970s", pos: ["SG"], ppg: 18.5, rpg: 3.0, apg: 3.5, spg: 1.5, bpg: 0.3, tov: 2.2 },
  { name: "Bob Dandridge", team: "Washington Bullets", decade: "1970s", pos: ["SF","PF"], ppg: 19.5, rpg: 6.5, apg: 3.5, spg: 1.3, bpg: 0.5, tov: 2.3 },
  { name: "Kevin Porter", team: "Washington Bullets", decade: "1970s", pos: ["PG"], ppg: 12.5, rpg: 2.5, apg: 7.5, spg: 1.5, bpg: 0.1, tov: 3.0 },
  { name: "Mitch Kupchak", team: "Washington Bullets", decade: "1970s", pos: ["PF","C"], ppg: 12.0, rpg: 7.0, apg: 1.5, spg: 0.7, bpg: 0.5, tov: 1.7 },

  // --- Seattle SuperSonics 1970s ---
  { name: "Spencer Haywood", team: "Seattle SuperSonics", decade: "1970s", pos: ["PF","C"], ppg: 24.5, rpg: 11.5, apg: 2.0, spg: 0.9, bpg: 1.2, tov: 2.7 },
  { name: "Fred Brown", team: "Seattle SuperSonics", decade: "1970s", pos: ["SG","SF"], ppg: 18.5, rpg: 3.0, apg: 3.5, spg: 1.2, bpg: 0.2, tov: 2.2 },
  { name: "Dennis Johnson", team: "Seattle SuperSonics", decade: "1970s", pos: ["SG","PG"], ppg: 15.5, rpg: 4.0, apg: 3.0, spg: 1.8, bpg: 0.6, tov: 2.3 },
  { name: "Gus Williams", team: "Seattle SuperSonics", decade: "1970s", pos: ["PG"], ppg: 16.5, rpg: 3.0, apg: 4.5, spg: 2.0, bpg: 0.2, tov: 2.5 },
  { name: "Jack Sikma", team: "Seattle SuperSonics", decade: "1970s", pos: ["C","PF"], ppg: 13.5, rpg: 9.5, apg: 2.5, spg: 0.9, bpg: 0.8, tov: 2.0 },
  { name: "Paul Silas", team: "Seattle SuperSonics", decade: "1970s", pos: ["PF"], ppg: 9.5, rpg: 10.5, apg: 2.0, spg: 1.0, bpg: 0.4, tov: 1.7 },

  // --- Seattle SuperSonics 1980s ---
  { name: "Jack Sikma", team: "Seattle SuperSonics", decade: "1980s", pos: ["C","PF"], ppg: 17.5, rpg: 10.0, apg: 3.5, spg: 0.9, bpg: 0.9, tov: 2.3 },
  { name: "Gus Williams", team: "Seattle SuperSonics", decade: "1980s", pos: ["PG"], ppg: 18.5, rpg: 3.0, apg: 4.5, spg: 1.8, bpg: 0.2, tov: 2.7 },
  { name: "Dale Ellis", team: "Seattle SuperSonics", decade: "1980s", pos: ["SG","SF"], ppg: 20.5, rpg: 4.0, apg: 2.0, spg: 1.0, bpg: 0.3, tov: 1.8 },
  { name: "Xavier McDaniel", team: "Seattle SuperSonics", decade: "1980s", pos: ["SF","PF"], ppg: 20.0, rpg: 7.5, apg: 2.0, spg: 1.2, bpg: 0.6, tov: 2.3 },
  { name: "Tom Chambers", team: "Seattle SuperSonics", decade: "1980s", pos: ["PF","SF"], ppg: 20.5, rpg: 6.5, apg: 2.5, spg: 0.8, bpg: 0.6, tov: 2.3 },
  { name: "Nate McMillan", team: "Seattle SuperSonics", decade: "1980s", pos: ["PG"], ppg: 7.5, rpg: 3.5, apg: 7.5, spg: 2.0, bpg: 0.2, tov: 2.2 },

  // --- Seattle SuperSonics 1990s ---
  { name: "Gary Payton", team: "Seattle SuperSonics", decade: "1990s", pos: ["PG"], ppg: 20.5, rpg: 4.5, apg: 7.5, spg: 2.2, bpg: 0.3, tov: 2.7 },
  { name: "Shawn Kemp", team: "Seattle SuperSonics", decade: "1990s", pos: ["PF","C"], ppg: 18.5, rpg: 9.5, apg: 2.0, spg: 1.0, bpg: 1.2, tov: 2.6 },
  { name: "Detlef Schrempf", team: "Seattle SuperSonics", decade: "1990s", pos: ["SF","PF"], ppg: 17.5, rpg: 6.5, apg: 4.5, spg: 1.0, bpg: 0.4, tov: 2.3 },
  { name: "Hersey Hawkins", team: "Seattle SuperSonics", decade: "1990s", pos: ["SG"], ppg: 14.5, rpg: 3.5, apg: 2.5, spg: 1.5, bpg: 0.2, tov: 1.7 },
  { name: "Sam Perkins", team: "Seattle SuperSonics", decade: "1990s", pos: ["PF","C"], ppg: 12.5, rpg: 5.5, apg: 1.5, spg: 0.7, bpg: 0.9, tov: 1.3 },
  { name: "Vin Baker", team: "Seattle SuperSonics", decade: "1990s", pos: ["PF","C"], ppg: 15.5, rpg: 8.0, apg: 1.8, spg: 0.7, bpg: 0.9, tov: 2.3 },

  // --- Seattle SuperSonics 2000s ---
  { name: "Ray Allen", team: "Seattle SuperSonics", decade: "2000s", pos: ["SG"], ppg: 24.5, rpg: 4.5, apg: 4.0, spg: 1.1, bpg: 0.2, tov: 2.5 },
  { name: "Rashard Lewis", team: "Seattle SuperSonics", decade: "2000s", pos: ["SF","PF"], ppg: 20.5, rpg: 6.5, apg: 3.0, spg: 1.0, bpg: 0.5, tov: 2.3 },
  { name: "Gary Payton", team: "Seattle SuperSonics", decade: "2000s", pos: ["PG"], ppg: 22.0, rpg: 4.5, apg: 8.0, spg: 1.9, bpg: 0.3, tov: 2.9 },
  { name: "Nick Collison", team: "Seattle SuperSonics", decade: "2000s", pos: ["PF","C"], ppg: 8.5, rpg: 6.5, apg: 1.2, spg: 0.6, bpg: 0.6, tov: 1.2 },
  { name: "Luke Ridnour", team: "Seattle SuperSonics", decade: "2000s", pos: ["PG"], ppg: 12.5, rpg: 2.5, apg: 5.5, spg: 1.0, bpg: 0.2, tov: 2.0 },
  { name: "Kevin Durant", team: "Seattle SuperSonics", decade: "2000s", pos: ["SF"], ppg: 20.5, rpg: 4.5, apg: 2.5, spg: 1.0, bpg: 0.9, tov: 2.8 },
];
